import { createZodDto, ZodDto } from 'nestjs-zod';
import {
  NotePatchRequestSchema,
  NoteReadRequestSchema,
} from '../../../application/services/note-ai/request-schemas';

const NoteReadRequestDtoBase: ZodDto<typeof NoteReadRequestSchema, false> =
  createZodDto(NoteReadRequestSchema);

const NotePatchRequestDtoBase: ZodDto<typeof NotePatchRequestSchema, false> =
  createZodDto(NotePatchRequestSchema);

export class NoteReadRequestDto extends NoteReadRequestDtoBase {}

export class NotePatchRequestDto extends NotePatchRequestDtoBase {}
