import 'dotenv/config';
import { NacosConfigClient } from 'nacos';
import * as yaml from 'yaml';

// 写死的常量，不走动态配置
export const KAFKA_TOPIC_SNAPSHOT = 'wisepen-note-snapshot-topic';
export const KAFKA_TOPIC_OPLOG = 'wisepen-note-oplog-topic';

// -----------------------------------------------------------------------------
// bootstrapConfig：Nacos 拉配置之前必须就位的最小配置集合
// -----------------------------------------------------------------------------
export const bootstrapConfig = {
  port: parseInt(process.env.PORT || '9700', 10),
  profile: process.env.PROFILE || 'dev',
  nacos: {
    serverAddr: process.env.NACOS_SERVER_ADDR || '127.0.0.1:8848',
    namespace: process.env.NACOS_NAMESPACE || 'public',
    group: process.env.NACOS_GROUP || 'DEFAULT_GROUP',
    username: process.env.NACOS_USERNAME || '',
    password: process.env.NACOS_PASSWORD || '',
  },
  serviceName: 'wisepen-note-collab-service',
};

// -----------------------------------------------------------------------------
// config：运行期可变配置容器
// -----------------------------------------------------------------------------
export const config: any = {
  ...bootstrapConfig,
  kafka: {
    brokers: [] as string[],
  },
  collab: {
    checkpointInterval: 10,
    snapshotFlushIntervalMs: 5000,
    roomIdleDestroyDelayMs: 30000,
  },
  inetutils: {
    ignoredInterfaces: [/VMnet.*/, /vEthernet.*/, /docker0/],
    preferredNetworks: ['10'] as string[],
  },
  security: {
    fromSourceSecret: 'APISIX-wX0iR6tY',
  },
  developer: {
    name: process.env.DEVELOPER_ENABLE === 'true' ? process.env.DEVELOPER_NAME?.trim() || undefined : undefined,
  },
};

function applyRemoteConfig(remoteConfig: any): void {
  if (!remoteConfig) return;

  if (remoteConfig.kafka?.brokers) {
    config.kafka.brokers = String(remoteConfig.kafka.brokers).split(',');
  }
  if (remoteConfig.collab) {
    config.collab.checkpointInterval =
      remoteConfig.collab['checkpoint-interval'] ?? config.collab.checkpointInterval;
    config.collab.snapshotFlushIntervalMs =
      remoteConfig.collab['snapshot-flush-interval-ms'] ?? config.collab.snapshotFlushIntervalMs;
    config.collab.roomIdleDestroyDelayMs =
      remoteConfig.collab['room-idle-destroy-delay-ms'] ?? config.collab.roomIdleDestroyDelayMs;
  }
  if (remoteConfig.inetutils) {
    const rawIgnored: string =
      remoteConfig.inetutils['ignored-interfaces'] ?? '';
    const rawPreferred: string =
      remoteConfig.inetutils['preferred-networks'] ?? '';
    if (rawIgnored) {
      config.inetutils.ignoredInterfaces = rawIgnored
        .split(',')
        .filter(Boolean)
        .map((pattern: string) => new RegExp(pattern));
    }
    if (rawPreferred) {
      config.inetutils.preferredNetworks = rawPreferred.split(',').filter(Boolean);
    }
  }
  if (remoteConfig.security?.['from-source-secret']) {
    config.security.fromSourceSecret = remoteConfig.security['from-source-secret'];
  }
}

export async function loadNacosConfig(): Promise<void> {
  const dataId = `${bootstrapConfig.serviceName}-${bootstrapConfig.profile}.yaml`;

  const configClient = new NacosConfigClient({
    serverAddr: bootstrapConfig.nacos.serverAddr,
    namespace: bootstrapConfig.nacos.namespace,
    username: bootstrapConfig.nacos.username,
    password: bootstrapConfig.nacos.password,
    requestTimeout: 10000,
  });

  try {
    const content = await configClient.getConfig(dataId, bootstrapConfig.nacos.group);
    applyRemoteConfig(yaml.parse(content));

    configClient.subscribe(
      { dataId, group: bootstrapConfig.nacos.group },
      (newContent: string) => {
        try {
          applyRemoteConfig(yaml.parse(newContent));
        } catch (e) {
          console.error('[Config] Parse error on hot-reload', e);
        }
      },
    );
  } catch (err) {
    console.error(`[Config] FATAL: Failed to load config [${dataId}]`, err);
    throw err;
  }
}
