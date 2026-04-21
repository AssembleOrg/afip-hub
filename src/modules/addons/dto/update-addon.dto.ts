import { PartialType } from '@nestjs/swagger';
import { CreateAddOnDto } from './create-addon.dto';

export class UpdateAddOnDto extends PartialType(CreateAddOnDto) {}
