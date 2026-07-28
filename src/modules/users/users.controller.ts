import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserMfgAttributesDto } from './dto/update-user-mfg-attributes.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.USER, action: PermissionAction.CREATE })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.USER, action: PermissionAction.VIEW })
  findAll(@Query() query: PaginationQueryDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.USER, action: PermissionAction.VIEW })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.USER, action: PermissionAction.UPDATE })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') currentUserId: string,
  ) {
    return this.usersService.update(id, dto, currentUserId);
  }

  @Patch(':id/mfg-attributes')
  @RequirePermissions({ module: PERMISSION_MODULES.USER, action: PermissionAction.UPDATE })
  updateMfgAttributes(@Param('id') id: string, @Body() dto: UpdateUserMfgAttributesDto) {
    return this.usersService.updateMfgAttributes(id, dto);
  }

  // Admin resets another user's password (forgot-password flow - the admin creates and
  // manages accounts). No currentPassword required; guarded by USER:UPDATE like the other
  // admin mutations. Self-service change (with currentPassword) lives at POST /auth/change-password.
  @Patch(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.USER, action: PermissionAction.UPDATE })
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto): Promise<void> {
    return this.usersService.resetPassword(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.USER, action: PermissionAction.DELETE })
  remove(@Param('id') id: string, @CurrentUser('id') currentUserId: string) {
    return this.usersService.remove(id, currentUserId);
  }
}
