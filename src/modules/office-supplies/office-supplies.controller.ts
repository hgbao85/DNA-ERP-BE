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
import { AdjustOfficeSupplyQuantityDto } from './dto/adjust-office-supply-quantity.dto';
import { CreateOfficeSupplyDto } from './dto/create-office-supply.dto';
import { ListOfficeSuppliesQueryDto } from './dto/list-office-supplies-query.dto';
import { UpdateOfficeSupplyDto } from './dto/update-office-supply.dto';
import { OfficeSuppliesService } from './office-supplies.service';

@ApiTags('Office Supplies')
@ApiBearerAuth()
@Controller({ path: 'office-supplies', version: '1' })
export class OfficeSuppliesController {
  constructor(private readonly officeSuppliesService: OfficeSuppliesService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.OFFICE_SUPPLY, action: PermissionAction.CREATE })
  create(
    @Body() dto: CreateOfficeSupplyDto,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.officeSuppliesService.create(dto, warehouseScope);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.OFFICE_SUPPLY, action: PermissionAction.VIEW })
  findAll(
    @Query() query: ListOfficeSuppliesQueryDto,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.officeSuppliesService.findAll(query, warehouseScope);
  }

  @Get(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.OFFICE_SUPPLY, action: PermissionAction.VIEW })
  findOne(@Param('id') id: string, @CurrentUser('warehouseScope') warehouseScope: string | null) {
    return this.officeSuppliesService.findOne(id, warehouseScope);
  }

  @Get(':id/ledger')
  @RequirePermissions({ module: PERMISSION_MODULES.OFFICE_SUPPLY, action: PermissionAction.VIEW })
  listLedger(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.officeSuppliesService.listLedger(id, query, warehouseScope);
  }

  @Patch(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.OFFICE_SUPPLY, action: PermissionAction.UPDATE })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOfficeSupplyDto,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.officeSuppliesService.update(id, dto, warehouseScope);
  }

  @Post(':id/adjust')
  @RequirePermissions({ module: PERMISSION_MODULES.OFFICE_SUPPLY, action: PermissionAction.UPDATE })
  adjustQuantity(
    @Param('id') id: string,
    @Body() dto: AdjustOfficeSupplyQuantityDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.officeSuppliesService.adjustQuantity(id, dto, userId, warehouseScope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.OFFICE_SUPPLY, action: PermissionAction.DELETE })
  remove(@Param('id') id: string, @CurrentUser('warehouseScope') warehouseScope: string | null) {
    return this.officeSuppliesService.remove(id, warehouseScope);
  }
}
