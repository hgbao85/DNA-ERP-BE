import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDefectReasonDto } from './create-defect-reason.dto';
import { UpdateDefectReasonDto } from './update-defect-reason.dto';

/** 20/11/2026 (T4-8): nhãn lý do lỗi tối đa 100 ký tự. */
describe('CreateDefectReasonDto - độ dài nhãn', () => {
  const MSG = 'Tên lý do lỗi chỉ được tối đa 100 ký tự';

  it('nhãn 101 ký tự bị từ chối kèm câu tiếng Việt', async () => {
    const errors = await validate(
      plainToInstance(CreateDefectReasonDto, { label: 'a'.repeat(101) }),
    );
    expect(errors.flatMap((e) => Object.values(e.constraints ?? {}))).toContain(MSG);
  });

  it('nhãn đúng 100 ký tự được nhận', async () => {
    const errors = await validate(
      plainToInstance(CreateDefectReasonDto, { label: 'a'.repeat(100) }),
    );
    expect(errors).toHaveLength(0);
  });

  it('sửa nhãn 101 ký tự cũng bị từ chối', async () => {
    const errors = await validate(
      plainToInstance(UpdateDefectReasonDto, { label: 'a'.repeat(101) }),
    );
    expect(errors.flatMap((e) => Object.values(e.constraints ?? {}))).toContain(MSG);
  });
});
