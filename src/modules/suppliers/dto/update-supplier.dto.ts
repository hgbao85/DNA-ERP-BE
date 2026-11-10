import { PartialType } from '@nestjs/swagger';
import { CreateSupplierDto } from './create-supplier.dto';

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  // isActive đã nằm trong CreateSupplierDto (test tay 09/11 điểm 21).
}
