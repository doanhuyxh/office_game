using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Payroll.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialPayroll : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "payroll");

            migrationBuilder.CreateTable(
                name: "adjustments",
                schema: "payroll",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PeriodId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Label = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    AmountEncrypted = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Taxable = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_adjustments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "payslips",
                schema: "payroll",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PeriodId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    DataEncrypted = table.Column<string>(type: "text", nullable: false),
                    ComputedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payslips", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "periods",
                schema: "payroll",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Month = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ComputedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LockedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LockedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SettingsId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_periods", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "profiles",
                schema: "payroll",
                columns: table => new
                {
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Dependents = table.Column<int>(type: "integer", nullable: false),
                    Insured = table.Column<bool>(type: "boolean", nullable: true),
                    TaxCode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_profiles", x => x.EmployeeId);
                });

            migrationBuilder.CreateTable(
                name: "settings",
                schema: "payroll",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EffectiveFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    RulesJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_settings", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_adjustments_PeriodId_EmployeeId",
                schema: "payroll",
                table: "adjustments",
                columns: new[] { "PeriodId", "EmployeeId" });

            migrationBuilder.CreateIndex(
                name: "IX_payslips_EmployeeId",
                schema: "payroll",
                table: "payslips",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_payslips_PeriodId_EmployeeId",
                schema: "payroll",
                table: "payslips",
                columns: new[] { "PeriodId", "EmployeeId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_periods_Month",
                schema: "payroll",
                table: "periods",
                column: "Month",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_settings_EffectiveFrom",
                schema: "payroll",
                table: "settings",
                column: "EffectiveFrom",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "adjustments",
                schema: "payroll");

            migrationBuilder.DropTable(
                name: "payslips",
                schema: "payroll");

            migrationBuilder.DropTable(
                name: "periods",
                schema: "payroll");

            migrationBuilder.DropTable(
                name: "profiles",
                schema: "payroll");

            migrationBuilder.DropTable(
                name: "settings",
                schema: "payroll");
        }
    }
}
