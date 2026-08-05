import { config } from '../../config';
import * as os from 'os';
import { NacosNamingClient } from 'nacos';
import { processDeveloper } from '../../developer-config';
import { getCurrentDeveloper } from '../../shared/gray/gray-context-holder';
import { DEVELOPER_METADATA_KEY, selectDeveloperInstances } from './developer-isolation';

export let nacosNamingClient: any;

const nacosSilentLogger = {
  ...console,
  info: (...args: any[]) => {},
  debug: (...args: any[]) => {},
  warn: (...args: any[]) => console.warn(...args),
  error: (msg: any, err?: any) => {
    const errorString = String(msg || '') + String(err || '');
    // 拦截极其烦人的 EADDRINUSE 和心跳发送失败报错
    if (errorString.includes('EADDRINUSE') || errorString.includes('CLIENT-BEAT') || errorString.includes('HostReactor')) {
      return; // 假装没看见，丢进黑洞
    }
    console.error('[Nacos Error]', msg, err);
  }
} as Console;

function resolveRegisterIp(): string {
  // 优先用 NACOS_REGISTER_IP
  if (process.env.NACOS_REGISTER_IP) return process.env.NACOS_REGISTER_IP;

  // 否则遍历网卡
  const nets = os.networkInterfaces();
  const { ignoredInterfaces, preferredNetworks } = config.inetutils;

  let fallbackIp = '127.0.0.1';
  let hasValidFallback = false;

  for (const name of Object.keys(nets)) {
    // 跳过 IGNORED_INTERFACES
    if (ignoredInterfaces.some((regex: RegExp) => regex.test(name))) {
      continue;
    }

    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) {
        // 优先选择 PREFERRED_NETWORKS 指定网段前缀
        if (preferredNetworks.some((prefix: string) => n.address.startsWith(`${prefix}.`))) {
          return n.address;
        }
        if (!hasValidFallback) {
          fallbackIp = n.address;
          hasValidFallback = true;
        }
      }
    }
    // 如果都没有，则使用 fallbackIp（第一个可用 IPv4，否则127.0.0.1）
  }
  return fallbackIp;
}

export async function registerWithNacos(): Promise<void> {
  try {
    if (!nacosNamingClient) {
      nacosNamingClient = new NacosNamingClient({
        logger: nacosSilentLogger,
        serverList: config.nacos.serverAddr,
        namespace: config.nacos.namespace,
        username: config.nacos.username,
        password: config.nacos.password
      });
      await nacosNamingClient.ready();
    }

    const registerIp = resolveRegisterIp();
    await nacosNamingClient.registerInstance(config.serviceName, {
      ip: registerIp,
      port: config.port,
      healthy: true,
      enabled: true,
      weight: 1,
      groupName: config.nacos.group,
      metadata: {
        'preserved.register.source': 'NODEJS',
        'version': '1.0.0',
        ...(processDeveloper ? { [DEVELOPER_METADATA_KEY]: processDeveloper } : {}),
      }
    });

    console.log(
      `[Nacos] Registered at ${registerIp}:${config.port}` +
        (processDeveloper ? ` developer=${processDeveloper}` : ''),
    );
  } catch (err) {
    console.error('[Nacos] Registration failed, retrying...', err);
    setTimeout(registerWithNacos, 5000);
  }
}

export async function deregisterFromNacos(): Promise<void> {
  if (nacosNamingClient) {
    try {
      const registerIp = resolveRegisterIp();
      await nacosNamingClient.deregisterInstance(config.serviceName, {
        ip: registerIp,
        port: config.port,
        groupName: config.nacos.group
      });
      await nacosNamingClient.close();
      console.log('[Nacos] Deregistered successfully.');
    } catch (err) {
      console.error('[Nacos] Deregistration failed', err);
    }
  }
}

interface NacosInstance {
  ip: string;
  port: number;
  metadata?: Record<string, string>;
}

export async function getServiceUrl(serviceName: string): Promise<string> {
  if (!nacosNamingClient) throw new Error('Nacos Client uninitialized.');
  const instances = (await nacosNamingClient.selectInstances(
    serviceName,
    config.nacos.group, 
    'DEFAULT',
    true
  )) as NacosInstance[];
  const candidates = selectDeveloperInstances(instances ?? [], getCurrentDeveloper());
  if (candidates.length === 0) {
    throw new Error(`No matching instances for ${serviceName}`);
  }
  const instance = candidates[Math.floor(Math.random() * candidates.length)];
  return `http://${instance.ip}:${instance.port}`;
}

