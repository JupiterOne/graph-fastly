import { IntegrationProviderAPIError } from '@jupiterone/integration-sdk-core';
import axios from 'axios';
import { IntegrationConfig } from '../types';
import {
  FastlyUser,
  FastlyAccount,
  FastlyService,
  FastlyServiceBackend,
  FastlyServiceDomain,
  FastlyToken,
} from './types';

export type ResourceIteratee<T> = (each: T) => Promise<void> | void;

const HOSTNAME = 'api.fastly.com';

export class APIClient {
  private _config: IntegrationConfig;

  constructor(readonly config: IntegrationConfig) {
    this._config = config;
  }

  private async getData<T>(path: string, args?: object): Promise<T> {
    const url = `https://${HOSTNAME}${path.startsWith('/') ? '' : '/'}${path}`;
    try {
      const { data } = await axios.get<T>(url, {
        headers: {
          Accept: 'application/json',
          'Fastly-Key': this._config.apiToken,
        },
        params: args,
      });
      return data;
    } catch (err) {
      const response = err.response || {};
      throw new IntegrationProviderAPIError({
        cause: err,
        endpoint: url,
        status: response.status || err.status || 'UNKNOWN',
        statusText: response.statusText || err.statusText || 'UNKNOWN',
      });
    }
  }

  public async getCurrentUser(): Promise<FastlyUser> {
    return this.getData<FastlyUser>('/current_user');
  }

  public async getAccountDetails(): Promise<FastlyAccount> {
    return this.getData<FastlyAccount>(`/customer/${this._config.customerId}`);
  }

  public async iterateUsers(
    iteratee: ResourceIteratee<FastlyUser>,
  ): Promise<void> {
    const items = await this.getData<FastlyUser[]>(
      `/customer/${this._config.customerId}/users`,
    );
    for (const item of items) {
      await iteratee(item);
    }
  }

  public async iterateTokens(
    iteratee: ResourceIteratee<FastlyToken>,
  ): Promise<void> {
    const items = await this.getData<FastlyToken[]>(
      `/customer/${this._config.customerId}/tokens`,
    );
    for (const item of items) {
      await iteratee(item);
    }
  }

  public async iterateServices(
    iteratee: ResourceIteratee<FastlyService>,
  ): Promise<void> {
    const items = await this.getData<FastlyService[]>(`/service`);
    for (const item of items) {
      await iteratee(item);
    }
  }

  public async getServiceBackends(
    id: string,
    version: number,
  ): Promise<FastlyServiceBackend[]> {
    return await this.getData<FastlyServiceBackend[]>(
      `/service/${id}/version/${version}/backend`,
    );
  }

  public async getServiceDomains(
    id: string,
    version: number,
  ): Promise<FastlyServiceDomain[]> {
    return await this.getData<FastlyServiceDomain[]>(
      `/service/${id}/version/${version}/domain`,
    );
  }
}

export function createAPIClient(config: IntegrationConfig): APIClient {
  return new APIClient(config);
}
