/**
 * Dòng đề xuất mua gộp theo PI, nhưng dây / nệm là lựa chọn RIÊNG của từng dòng SKU trong PI (`wireMaterialId`,
 * `cushionMaterialId`) - 1 luật gán dòng mua ↔ dòng SKU dùng chung cho Bảng mốc và màn "Vật tư cần về" (Phần A – Đợt 4), cùng luật
 * `scopePurchasingRows` ở FE, để hai màn không nói hai điều khác nhau (review 32.26):
 *  - dòng mua của vật tư mà CHÍNH dòng SKU chọn (dây / nệm của mình) → thuộc dòng SKU đó;
 *  - dòng mua của vật tư mà một dòng SKU KHÁC trong cùng PI chọn (mà dòng này không chọn) → KHÔNG thuộc dòng SKU này;
 *  - mọi vật tư còn lại (sắt, đinh, sơn... dùng chung) → thuộc mọi dòng SKU trong PI.
 * `approvedChoices` phải gồm mọi dòng ĐÃ DUYỆT của các PI, kể cả dòng đã Kết thúc (không còn trên bảng): dây riêng của dòng đã xong
 * vẫn là của dòng đó, không được tính sang dòng còn chạy.
 */
export interface PurchaseLineChoice {
  id: bigint | string;
  productionInvoiceId: bigint | string | null;
  wireMaterialId: bigint | string | null;
  cushionMaterialId: bigint | string | null;
}

/** Id vật tư dây / nệm mà 1 dòng SKU chọn (dạng chuỗi). */
export function choiceMaterialIds(
  i: Pick<PurchaseLineChoice, 'wireMaterialId' | 'cushionMaterialId'>,
): string[] {
  return [i.wireMaterialId, i.cushionMaterialId].flatMap((m) => (m != null ? [String(m)] : []));
}

/** Dựng sẵn hàm "dòng mua của vật tư này có thuộc dòng SKU `item` không" (tính own/siblings 1 lần cho mỗi dòng SKU). */
export function purchaseLineMatcher(
  item: PurchaseLineChoice,
  approvedChoices: readonly PurchaseLineChoice[],
): (materialId: string) => boolean {
  const piId = String(item.productionInvoiceId);
  const own = new Set(choiceMaterialIds(item));
  const siblings = new Set(
    approvedChoices
      .filter((o) => String(o.id) !== String(item.id) && String(o.productionInvoiceId) === piId)
      .flatMap(choiceMaterialIds),
  );
  return (materialId) => own.has(materialId) || !siblings.has(materialId);
}

/** Dòng mua của vật tư `materialId` (cùng PI với `item`) có thuộc dòng SKU `item` không. */
export function purchaseLineUsedBy(
  item: PurchaseLineChoice,
  materialId: string,
  approvedChoices: readonly PurchaseLineChoice[],
): boolean {
  return purchaseLineMatcher(item, approvedChoices)(materialId);
}
