import { Logger } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import { config, KAFKA_TOPIC_SNAPSHOT, KAFKA_TOPIC_OPLOG } from '../../config';
import { OplogEntry } from '../../application/services/yjs/yjs-operation-logger';

const logger = new Logger('Kafka');

export interface NoteSnapshotMessage {
  resourceId: string;
  version: number;
  type: 'FULL' | 'DELTA';
  data: string; // base64
  plainText?: string;
  updatedBy: string[];
}

export interface NoteOperationLogMessage {
  resourceId: string;
  entries: OplogEntry[];
}

let producer: Producer;

export async function initKafkaProducer(): Promise<void> {
  const kafka = new Kafka({
    clientId: config.serviceName,
    brokers: config.kafka.brokers,
  });
  producer = kafka.producer();
  await producer.connect();
  logger.log('Producer connected');
}

export async function sendSnapshot(msg: NoteSnapshotMessage): Promise<void> {
  await producer.send({
    topic: KAFKA_TOPIC_SNAPSHOT,
    messages: [
      {
        key: msg.resourceId,
        value: JSON.stringify(msg),
      },
    ],
  });
}

export async function sendOperationLogs(msg: NoteOperationLogMessage): Promise<void> {
  if (msg.entries.length === 0) return;
  await producer.send({
    topic: KAFKA_TOPIC_OPLOG,
    messages: [
      {
        key: msg.resourceId,
        value: JSON.stringify(msg),
      },
    ],
  });
}

export async function disconnectKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect();
  }
}
