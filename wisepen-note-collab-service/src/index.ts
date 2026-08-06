import { Logger } from '@nestjs/common';
import { config, loadNacosConfig } from './config';
import {
  initKafkaProducer,
  disconnectKafka,
} from './infrastructure/messaging/kafka-producer';
import { registerWithNacos, deregisterFromNacos } from './infrastructure/discovery/nacos-registry';
import { createNestServer } from './transport/http/nest-app';

const logger = new Logger('Boot');

async function main(): Promise<void> {
  // 从 Nacos 拉取远程配置
  await loadNacosConfig();
  logger.log(`Starting ${config.serviceName} on port ${config.port}`);

  // 注册到 Nacos
  await registerWithNacos();

  // 初始化 Kafka producer
  await initKafkaProducer();

  const { app, server } = await createNestServer();

  server.listen(config.port, () => {
    logger.log(`HTTP + WebSocket server listening on :${config.port}`);
  });

  const shutdown = async () => {
    logger.log('Gracefully shutting down...');
    await deregisterFromNacos();
    await disconnectKafka();
    await app.close();
    server.close();
    process.exit(0);
  };

  // 监听 SIGINT / SIGTERM，做优雅关闭
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Fatal error', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
