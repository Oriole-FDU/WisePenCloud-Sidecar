import { config, loadNacosConfig } from './config';
import {
  initKafkaProducer,
  disconnectKafka,
} from './infrastructure/messaging/kafka-producer';
import { registerWithNacos, deregisterFromNacos } from './infrastructure/discovery/nacos-registry';
import { createNestServer } from './transport/http/nest-app';

async function main(): Promise<void> {
  // 从 Nacos 拉取远程配置
  await loadNacosConfig();
  console.log(`[Boot] Starting ${config.serviceName} on port ${config.port}`);

  // 注册到 Nacos
  await registerWithNacos();

  // 初始化 Kafka producer
  await initKafkaProducer();

  const { app, server } = await createNestServer();

  server.listen(config.port, () => {
    console.log(`[Boot] HTTP + WebSocket server listening on :${config.port}`);
  });

  const shutdown = async () => {
    console.log('[Shutdown] Gracefully shutting down...');
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
  console.error('[Boot] Fatal error:', err);
  process.exit(1);
});
