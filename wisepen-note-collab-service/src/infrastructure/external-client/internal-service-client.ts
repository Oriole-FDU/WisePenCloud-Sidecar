import axios, { AxiosInstance } from 'axios';
import { config } from '../../config';
import { CommonError, IResult, ServiceError } from '../../shared/errors';
import { DEVELOPER_HEADER } from '../../shared/gray/gray-context';
import { getCurrentDeveloper } from '../../shared/gray/gray-context-holder';
import { R } from '../../shared/types';
import { getServiceUrl } from '../discovery/nacos-registry';

function fromSourceHeader(): Record<string, string> {
  const developer = getCurrentDeveloper();
  return {
    'X-From-Source': config.security.fromSourceSecret,
    ...(developer ? { [DEVELOPER_HEADER]: developer } : {}),
  };
}

export async function createInternalServiceClient(serviceName: string): Promise<AxiosInstance> {
  const baseURL = await getServiceUrl(serviceName);
  return axios.create({
    baseURL,
    timeout: 10000,
    headers: fromSourceHeader(),
    validateStatus: () => true,
  });
}

function toRemoteServiceResult(response: Partial<R<unknown>>): IResult {
  return {
    code: typeof response.code === 'number' ? response.code : CommonError.REQUEST_ERROR.code,
    key: typeof response.key === 'string' ? response.key : CommonError.REQUEST_ERROR.key,
    msg: typeof response.msg === 'string' ? response.msg : CommonError.REQUEST_ERROR.msg,
  };
}

export function unwrapRequiredData<T>(
  response: R<T> | undefined,
): T {
  if (!response) {
    throw new ServiceError(CommonError.REQUEST_ERROR);
  }
  if (response.code !== 200) {
    throw new ServiceError(toRemoteServiceResult(response));
  }
  if (response.data === null || response.data === undefined) {
    throw new ServiceError(CommonError.REQUEST_ERROR);
  }
  return response.data;
}
