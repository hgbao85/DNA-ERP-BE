import { instanceToPlain } from 'class-transformer';
import { toContainerLoadDto } from '../../../common/dto/container-load.dto';
import { SkuResponseDto } from './sku-response.dto';

describe('SkuResponseDto.containerLoad - tuần tự hoá', () => {
  it('xuất đủ field của ContainerLoadDto', () => {
    const dto = new SkuResponseDto({
      id: '1',
      containerLoad: toContainerLoadDto({
        boxLengthCm: { toNumber: () => 85 },
        boxWidthCm: { toNumber: () => 80 },
        boxHeightCm: 100,
        boxesPerSet: 1,
        loadContManual: null,
        boxVolumeM3: { toNumber: () => 0.68 },
        loadContFormula: 100,
        loadCont: 100,
        containerLoadUpdatedAt: new Date('2026-11-04T00:00:00Z'),
      }),
      manhReviews: [],
      detailReviews: [],
    });
    const plain = instanceToPlain(dto) as { containerLoad: Record<string, unknown> };
    expect(plain.containerLoad).toEqual({
      boxLengthCm: 85,
      boxWidthCm: 80,
      boxHeightCm: 100,
      boxesPerSet: 1,
      loadContManual: null,
      boxVolumeM3: 0.68,
      loadContFormula: 100,
      loadCont: 100,
      source: 'FORMULA',
      updatedAt: new Date('2026-11-04T00:00:00Z'),
    });
  });
});
