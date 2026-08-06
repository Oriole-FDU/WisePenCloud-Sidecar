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
import { getRoom } from '../../../application/services/yjs';
import { Room } from '../../../application/services/yjs/types';
import { applyPatchToActiveRoom, readActiveRoom } from '../../../application/services/note-ai/service';
import { NotePatchRequest, NoteReadRequest, NotePatchResponse } from '../../../application/services/note-ai/request-types';
import { encodeNoteXml } from '../../../application/services/note-ai/read/note-xml-codec';
import { getPublicBlockId } from '../../../application/services/note-ai/block-id-mapping-store';
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

function requireActiveRoom(resourceId: string): Room {
  const room = getRoom(resourceId);
  if (!room || room.connections.size === 0) {
    throw new ServiceError(CommonError.REQUEST_ERROR, 'NOTE_ROOM_NOT_ACTIVE');
  }
  return room;
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
    summary: '按范围以紧凑 XML 读取活跃笔记',
    description: `
- 用途：读取当前 Sidecar 实例中的活跃协同房间，并以紧凑 XML 暴露给内部 AI 工具。
- 请求：resourceId 指定目标笔记；body 可指定 scope、includeAiContent 和 version。
- 约束：当前用户必须已登录，且拥有目标资源 VIEW 权限；目标协同房间必须处于活跃状态。
- 处理：读取活跃 Y.Doc 快照，建立公开块 ID 映射，并在 scope 存在时解析短块 ID。
- 失败：未登录 -> PermissionError.NOT_LOGIN；权限不足 -> PermissionError.PERMISSION_DENIED；房间未激活 -> CommonError.REQUEST_ERROR。
- 响应：成功时返回 application/xml。
    `,
  })
  @Post('readXml')
  @HttpCode(200)
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @ApiQuery({ name: 'resourceId', required: true, description: '笔记资源 ID。' })
  @ApiBody({ type: NoteReadRequestDto, required: false })
  @ApiOkResponse({
    description: '读取成功；块 ID 为按文档顺序生成的短 ID',
    content: {
      'application/xml': {
        schema: { type: 'string' },
        example: '<document resourceId="note-1" version="yjs-v1:example"><paragraph id="p_001">第一句。</paragraph></document>',
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
    const room = requireActiveRoom(normalizedResourceId);
    const { document, mapping } = readActiveRoom(room, readRequest);
    return encodeNoteXml(document, (id) => getPublicBlockId(mapping, id));
  }

  @ApiOperation({
    summary: '向活跃笔记写入 AI Diff',
    description: `
- 用途：将内部 AI 工具生成的结构化 Diff 应用到当前 Sidecar 实例中的活跃协同房间。
- 请求：resourceId 指定目标笔记；body 描述 patchId、version 和 operations。
- 约束：当前用户必须已登录，且拥有目标资源 EDIT 权限；目标协同房间必须处于活跃状态；操作数量必须在 1 到 200 之间。
- 处理：解析公开块 ID，应用 patch，写入 Y.Doc，并返回逐操作处理结果。
- 失败：未登录 -> PermissionError.NOT_LOGIN；权限不足 -> PermissionError.PERMISSION_DENIED；块 ID 映射不存在 -> CommonError.REQUEST_PARAM_INVALID。
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
    const room = requireActiveRoom(normalizedResourceId);
    const data = applyPatchToActiveRoom(room, request as NotePatchRequest, userId);
    return {
      code: 200,
      key: null,
      msg: 'success',
      data,
    };
  }
}
