import {
  createDirectRelationship,
  createIntegrationEntity,
  IntegrationStep,
  IntegrationStepExecutionContext,
  RelationshipClass,
  getTime,
  convertProperties,
  createMappedRelationship,
  RelationshipDirection,
  Entity,
} from '@jupiterone/integration-sdk-core';

import { createAPIClient } from '../provider/client';
import { IntegrationConfig } from '../types';

export async function fetchServices({
  instance,
  jobState,
}: IntegrationStepExecutionContext<IntegrationConfig>) {
  const accountEntity = (await jobState.getData(
    `fastly-account:${instance.config.customerId}`,
  )) as Entity;

  const apiClient = createAPIClient(instance.config);

  await apiClient.iterateServices(async (data) => {
    const serviceEntity = createIntegrationEntity({
      entityData: {
        source: data,
        assign: {
          _type: 'fastly_service',
          _class: 'Service',
          _key: `fastly-service:${data.id}`,
          id: data.id,
          displayName: data.name || data.id,
          name: data.name,
          category: ['infrastructure'],
          description: data.comment,
          version: data.version,
          /**
           * Fastly "Service" description: https://developer.fastly.com/reference/api/services/service/
           *
           * A Service represents the configuration for a website, app, API, or
           * anything else to be served through Fastly. A Service can have many
           * Versions, through which Backends, Domains, and more can be configured.
           */
          function: [],
          createdOn: getTime(data.created_at),
          updatedOn: getTime(data.updated_at),
        },
      },
    });

    await Promise.all([
      jobState.addEntity(serviceEntity),
      jobState.addRelationship(
        createDirectRelationship({
          _class: RelationshipClass.HAS,
          from: accountEntity,
          to: serviceEntity,
        }),
      ),
    ]);

    const backends = await apiClient.getServiceBackends(data.id, data.version);

    for (const backend of backends) {
      const backendEntity = createIntegrationEntity({
        entityData: {
          source: backend,
          assign: {
            ...convertProperties(backend),
            _type: 'fastly_service_backend',
            _class: 'ApplicationEndpoint',
            _key: `fastly-service-backend:${backend.hostname}:${backend.address}:${backend.port}`,
            displayName: backend.name || backend.hostname || backend.address,
            description: backend.comment,
            ipAddress: backend.address,
            createdOn: getTime(backend.created_at),
            updatedOn: getTime(backend.updated_at),
            deletedOn: getTime(backend.deleted_at),
          },
        },
      });

      await Promise.all([
        jobState.addEntity(backendEntity),
        jobState.addRelationship(
          createDirectRelationship({
            _class: RelationshipClass.HAS,
            from: serviceEntity,
            to: backendEntity,
          }),
        ),
        jobState.addRelationship(
          createMappedRelationship({
            _type: 'fastly_service_backend_connects_host',
            _class: RelationshipClass.CONNECTS,
            _mapping: {
              sourceEntityKey: backendEntity._key,
              relationshipDirection: RelationshipDirection.FORWARD,
              targetFilterKeys: [
                ['_class', 'ipAddress'],
                ['_class', 'hostname'],
              ],
              targetEntity: {
                _class: ['Host', 'Gateway'],
                ipAddress: backend.address,
                hostname: backend.hostname,
              },
              skipTargetCreation: true,
            },
          }),
        ),
      ]);
    }

    const domains = await apiClient.getServiceDomains(data.id, data.version);

    for (const domain of domains) {
      await jobState.addRelationship(
        createMappedRelationship({
          _type: 'fastly_service_connects_domain_record',
          _class: RelationshipClass.CONNECTS,
          _mapping: {
            sourceEntityKey: serviceEntity._key,
            relationshipDirection: RelationshipDirection.FORWARD,
            targetFilterKeys: [['_class', 'name']],
            targetEntity: {
              _class: 'DomainRecord',
              name: domain.name,
            },
          },
          properties: {
            description: domain.comment,
            locked: domain.locked,
            createdOn: getTime(domain.created_at),
            updatedOn: getTime(domain.updated_at),
            deletedOn: getTime(domain.deleted_at),
          },
        }),
      );
    }
  });
}

export const serviceSteps: IntegrationStep<IntegrationConfig>[] = [
  {
    id: 'fetch-services',
    name: 'Fetch Services',
    entities: [
      {
        resourceName: 'Service',
        _type: 'fastly_service',
        _class: 'Service',
      },
      {
        resourceName: 'Service Backend',
        _type: 'fastly_service_backend',
        _class: 'ApplicationEndpoint',
      },
    ],
    relationships: [
      {
        _type: 'fastly_account_has_service',
        _class: RelationshipClass.HAS,
        sourceType: 'fastly_account',
        targetType: 'fastly_service',
      },
      {
        _type: 'fastly_service_has_backend',
        _class: RelationshipClass.HAS,
        sourceType: 'fastly_service',
        targetType: 'fastly_service_backend',
      },
      {
        _type: 'fastly_service_backend_connects_host',
        _class: RelationshipClass.CONNECTS,
        sourceType: 'fastly_service_backend',
        targetType: 'Host or Gateway',
      },
      {
        _type: 'fastly_service_connects_domain_record',
        _class: RelationshipClass.CONNECTS,
        sourceType: 'fastly_service',
        targetType: 'DomainRecord',
      },
    ],
    dependsOn: ['fetch-account'],
    executionHandler: fetchServices,
  },
];
