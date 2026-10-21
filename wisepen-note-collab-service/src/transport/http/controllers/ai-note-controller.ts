import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { acquireRoom, releaseRoom } from '../../../application/services/yjs';
import { flushRoom } from '../../../application/services/yjs/yjs-snapshot-flusher';
import { applyPatchToActiveRoom, readActiveRoom } from '../../../application/services/note-ai/service';
import { NotePatchRequest, NoteReadRequest, NotePatchResponse } from '../../../application/services/note-ai/request-types';
import { encodeNoteXml } from '../../../application/services/note-ai/read/note-xml-codec';
import { getSecurityContext } from '../../../shared/context/request-context-holder';
import { CommonError, PermissionError, ServiceError } from '../../../shared/errors';
import { checkSecurityPolicy } from '../../../shared/security/security-aspect';
import { R } from '../../../shared/types';
import { checkPermission } from '../../../infrastructure/external-client/resource-service-client';
import { NotePatchRequestDto, NoteReadRequestDto } from '../dtos/ai-note-dtos';

function requireResourceId(resourceId: string | undefined): string {
  const normalized = typeof resourceId === 'string' ? resourceId.trim() : '';
  if (!normalized) {
    throw new ServiceError(CommonError.REQUEST_PARAM_REQUIRED_MISSING, '缺少 resourceId');
  }
  return normalized;
}

@ApiTags('AI Note')
@ApiSecurity('UserID')
@ApiHeader({
  name: 'X-Group-Role-Map',
  required: false,
  description: '用户小组角色 JSON。',
  example: '{"10001":0}',
})
@Controller('internal/ai-note')
export class AiNoteController {
  @ApiOperation({
    summary: '按范围以紧凑 XML 读取笔记',
    description: `
- 用途：读取笔记的协同状态，并以紧凑 XML 暴露给内部 AI 工具；文档未打开时会从最新持久化快照加载。
- 请求：resourceId 指定目标笔记；body 可指定 scope 和 includeAiContent。
- 约束：当前用户必须已登录，且拥有目标资源 VIEW 权限。
- 处理：读取当前共享 Room 的 Y.Doc；Room 不存在时从 Note Service 冷加载，并按 scope 裁剪；块 ID 均为笔记中真实的块 ID。
- 失败：未登录 -> PermissionError.NOT_LOGIN；权限不足 -> PermissionError.PERMISSION_DENIED。
- 响应：成功时返回 application/xml。
    `,
  })
  @Post('readXml')
  @HttpCode(200)
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @ApiQuery({ name: 'resourceId', required: true, description: '笔记资源 ID。' })
  @ApiBody({ type: NoteReadRequestDto, required: false })
  @ApiOkResponse({
    description: '读取成功；块 ID 为笔记中真实的块 ID',
    content: {
      'application/xml': {
        schema: { type: 'string' },
        example: '<document resourceId="note-1" version="yjs-v1:example"><paragraph id="kV9mQ2x9Kd0pTr4LwZ1s">第一句。</paragraph></document>',
      },
    },
  })
  async readXml(
    @Query('resourceId') resourceId: string | undefined,
    @Body() request: NoteReadRequestDto | undefined,
  ): Promise<string> {
    checkSecurityPolicy({ login: true });
    const securityContext = getSecurityContext()!;
    const userId = securityContext.userId!;
    const normalizedResourceId = requireResourceId(resourceId);
    const permission = await checkPermission(
      normalizedResourceId,
      userId,
      securityContext.groupRoleMap,
    );
    if (
      permission.resourceAccessRole === 'NONE' ||
      !permission.allowedActions?.includes('VIEW')
    ) {
      throw new ServiceError(PermissionError.PERMISSION_DENIED);
    }
    const readRequest = (request ?? {}) as NoteReadRequest;
    const room = await acquireRoom(normalizedResourceId);
    try {
      return encodeNoteXml(readActiveRoom(room, readRequest));
    } finally {
      releaseRoom(room);
    }
  }

  @ApiOperation({
    summary: '向笔记写入 AI Diff',
    description: `
- 用途：将内部 AI 工具生成的结构化 Diff 应用到笔记；文档未打开时会从最新持久化快照加载。
- 请求：resourceId 指定目标笔记；body 描述 patchId、version 和 operations。
- 约束：当前用户必须已登录，且拥有目标资源 EDIT 权限；操作数量必须在 1 到 200 之间。
- 处理：在当前共享 Room 中按真实块 ID 逐项应用建议；请求版本不一致只通过 modified 返回，不阻止仍可执行的操作；发生写入时在返回前发送快照。
- 失败：未登录 -> PermissionError.NOT_LOGIN；权限不足 -> PermissionError.PERMISSION_DENIED。
- 响应：成功时返回处理结果。
    `,
  })
  @Post('apply')
  @HttpCode(200)
  @ApiQuery({ name: 'resourceId', required: true, description: '笔记资源 ID。' })
  @ApiBody({ type: NotePatchRequestDto, required: true })
  @ApiOkResponse({ description: '处理完成；逐操作结果位于 data.results' })
  async apply(
    @Query('resourceId') resourceId: string | undefined,
    @Body() request: NotePatchRequestDto,
  ): Promise<R<NotePatchResponse>> {
    checkSecurityPolicy({ login: true });
    const securityContext = getSecurityContext()!;
    const userId = securityContext.userId!;
    const normalizedResourceId = requireResourceId(resourceId);
    const permission = await checkPermission(
      normalizedResourceId,
      userId,
      securityContext.groupRoleMap,
    );
    if (
      permission.resourceAccessRole === 'NONE' ||
      !permission.allowedActions?.includes('EDIT')
    ) {
      throw new ServiceError(PermissionError.PERMISSION_DENIED);
    }
    const room = await acquireRoom(normalizedResourceId);
    try {
      const data = applyPatchToActiveRoom(room, request as NotePatchRequest, userId);
      if (data.resultVersion !== data.currentVersion) {
        await flushRoom(room, { forceFull: room.connections.size === 0 });
      }
      return {
        code: 200,
        key: null,
        msg: 'success',
        data,
      };
    } finally {
      releaseRoom(room);
    }
  }
}
