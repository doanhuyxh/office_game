using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;

namespace OfficeHub.BuildingBlocks.Http;

/// <summary>
/// Gom lỗi validation theo field rồi trả ValidationProblem (400) — FE hiển thị theo field.
/// Dùng: var v = new Validation(); v.Required(req.Name, "name", "Tên"); if (v.Failed) return v.Problem();
/// </summary>
public sealed class Validation
{
    private readonly Dictionary<string, List<string>> _errors = new();

    public bool Failed => _errors.Count > 0;

    /// <summary>Lỗi theo field (vd để gắn vào từng dòng khi nhập Excel).</summary>
    public IReadOnlyDictionary<string, List<string>> Errors => _errors;

    /// <summary>Field đã có lỗi chưa (để bỏ qua kiểm tra phụ thuộc field đó).</summary>
    public bool Has(string field) => _errors.ContainsKey(field);

    public Validation Add(string field, string message)
    {
        if (!_errors.TryGetValue(field, out var list)) _errors[field] = list = [];
        list.Add(message);
        return this;
    }

    public Validation Required(string? value, string field, string label) =>
        string.IsNullOrWhiteSpace(value) ? Add(field, $"{label} không được để trống") : this;

    public Validation MaxLength(string? value, int max, string field, string label) =>
        value is not null && value.Length > max ? Add(field, $"{label} tối đa {max} ký tự") : this;

    public Validation Email(string? value, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) return this;
        return System.Net.Mail.MailAddress.TryCreate(value, out var a) && a.Address == value.Trim()
            ? this : Add(field, "Email không hợp lệ");
    }

    public Validation When(bool condition, string field, string message) => condition ? Add(field, message) : this;

    public ValidationProblem Problem() =>
        TypedResults.ValidationProblem(_errors.ToDictionary(k => k.Key, v => v.Value.ToArray()));
}

public static class Problems
{
    public static ProblemHttpResult NotFound(string what) =>
        TypedResults.Problem($"Không tìm thấy {what}", statusCode: StatusCodes.Status404NotFound);

    public static ProblemHttpResult Conflict(string message) =>
        TypedResults.Problem(message, statusCode: StatusCodes.Status409Conflict);
}
