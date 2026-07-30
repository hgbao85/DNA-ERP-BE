import { PartialType } from '@nestjs/swagger';
import { CreateMaterialGroupDto } from './create-material-group.dto';

export class UpdateMaterialGroupDto extends PartialType(CreateMaterialGroupDto) {}
