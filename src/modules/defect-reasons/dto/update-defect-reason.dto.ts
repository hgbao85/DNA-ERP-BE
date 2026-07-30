import { PartialType } from '@nestjs/swagger';
import { CreateDefectReasonDto } from './create-defect-reason.dto';

export class UpdateDefectReasonDto extends PartialType(CreateDefectReasonDto) {}
