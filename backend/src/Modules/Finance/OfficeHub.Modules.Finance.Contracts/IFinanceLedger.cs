namespace OfficeHub.Modules.Finance.Contracts;

/// <summary>
/// Phần công khai của sổ thu chi cho module khác (vd Sales ghi nhận tiền khách trả). Mỗi nguồn (<see cref="LedgerIncome.SourceType"/> + SourceId)
/// chỉ có một dòng sổ còn hiệu lực. Kế toán huỷ dòng ở sổ → module nguồn biết qua <see cref="ActiveSourcesAsync"/> (không có sự kiện).
/// </summary>
public interface IFinanceLedger
{
    /// <summary>Ghi một dòng THU (đã kiểm tra quyền ở caller). Lỗi dữ liệu (quỹ đóng, kỳ khoá, ngày tương lai…) trả theo field, không ném.</summary>
    Task<LedgerWriteResult> RecordIncomeAsync(LedgerIncome income, CancellationToken ct = default);

    /// <summary>Trong các SourceId đưa vào, những cái còn dòng sổ hiệu lực (chưa huỷ) → số tiền của dòng đó.</summary>
    Task<IReadOnlyDictionary<Guid, long>> ActiveSourcesAsync(string sourceType, IReadOnlyCollection<Guid> sourceIds, CancellationToken ct = default);
}

public sealed record LedgerIncome(string SourceType, Guid SourceId, DateOnly Date, long Amount, Guid AccountId, Guid? CategoryId, Guid? BusinessLineId,
    string? Counterparty, string? Description, string? InvoiceNumber, Guid CreatedByUserId, string CreatedByName);

/// <param name="Errors">field → thông báo (rỗng = thành công). Field theo tên của sổ: amount, date, accountId, categoryId, businessLineId…</param>
public sealed record LedgerWriteResult(Guid? EntryId, IReadOnlyDictionary<string, string> Errors)
{
    public bool Succeeded => EntryId is not null;
}
