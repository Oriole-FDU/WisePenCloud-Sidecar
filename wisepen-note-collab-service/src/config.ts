import 'dotenv/config';
import { NacosConfigClient } from 'nacos';
import * as yaml from 'yaml';

// 写死的常量，不走动态配置
export const KAFKA_TOPIC_SNAPSHOT = 'wisepen-note-snapshot-topic';
export const KAFKA_TOPIC_OPLOG = 'wisepen-note-oplog-topic';

// 解析本地 `.env` 的网卡过滤规则
const rawIgnored = process.env.IGNORED_INTERFACES || 'VMnet.*,vEthernet.*,docker0';
const rawPreferred = process.env.PREFERRED_NETWORKS || '10';

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
  serviceName: process.env.SERVICE_NAME || 'wisepen-note-collab-service',
  noteServiceName: 'wisepen-note-service',
  resourceServiceName: 'wisepen-resource-service',
};

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
    // 将逗号分隔的字符串转换为正则表达式数组和字符串数组
    ignoredInterfaces: rawIgnored.split(',').filter(Boolean).map(pattern => new RegExp(pattern)),
    preferredNetworks: rawPreferred.split(',').filter(Boolean),
  }
};

export async function loadNacosConfig(): Promise<void> {
  const dataId = `${bootstrapConfig.serviceName}-${bootstrapConfig.profile}.yaml`;
  
  const configClient = new NacosConfigClient({
    serverAddr: bootstrapConfig.nacos.serverAddr,
    namespace: bootstrapConfig.nacos.namespace,
    username: config.nacos.username,
    password: config.nacos.password,
    requestTimeout: 10000
  });

  try {
    const content = await configClient.getConfig(dataId, bootstrapConfig.nacos.group);
    const remoteConfig = yaml.parse(content);
    
    if (remoteConfig?.kafka?.brokers) {
      config.kafka.brokers = remoteConfig.kafka.brokers.split(',');
    }
    if (remoteConfig?.collab) {
      config.collab.checkpointInterval = remoteConfig.collab['checkpoint-interval'] ?? config.collab.checkpointInterval;
      config.collab.snapshotFlushIntervalMs = remoteConfig.collab['snapshot-flush-interval-ms'] ?? config.collab.snapshotFlushIntervalMs;
      config.collab.roomIdleDestroyDelayMs = remoteConfig.collab['room-idle-destroy-delay-ms'] ?? config.collab.roomIdleDestroyDelayMs;
    }

    configClient.subscribe({ dataId, group: bootstrapConfig.nacos.group }, (newContent: string) => {
      try {
        const updatedConfig = yaml.parse(newContent);
        if (updatedConfig?.kafka?.brokers) {
          config.kafka.brokers = updatedConfig.kafka.brokers.split(',');
        }
      } catch (e) {
        console.error('[Config] Parse error on hot-reload', e);
      }
    });
  } catch (err) {
    console.error(`[Config] FATAL: Failed to load config [${dataId}]`, err);
    throw err;
  }
}