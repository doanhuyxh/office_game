using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace OfficeHub.Modules.Finance.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialFinance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "finance");

            migrationBuilder.CreateTable(
                name: "accounts",
                schema: "finance",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    BankName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Last4 = table.Column<string>(type: "character varying(4)", maxLength: 4, nullable: true),
                    OpeningBalance = table.Column<long>(type: "bigint", nullable: false),
                    OpeningDate = table.Column<DateOnly>(type: "date", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_accounts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "business_lines",
                schema: "finance",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_business_lines", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "categories",
                schema: "finance",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_categories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "settings",
                schema: "finance",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    LockedThrough = table.Column<DateOnly>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_settings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "entries",
                schema: "finance",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    ToAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    BusinessLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    Counterparty = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    InvoiceNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    SourceType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: true),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    VoidReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    VoidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    VoidedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_entries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_entries_accounts_AccountId",
                        column: x => x.AccountId,
                        principalSchema: "finance",
                        principalTable: "accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_entries_accounts_ToAccountId",
                        column: x => x.ToAccountId,
                        principalSchema: "finance",
                        principalTable: "accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_entries_business_lines_BusinessLineId",
                        column: x => x.BusinessLineId,
                        principalSchema: "finance",
                        principalTable: "business_lines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_entries_categories_CategoryId",
                        column: x => x.CategoryId,
                        principalSchema: "finance",
                        principalTable: "categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "expense_requests",
                schema: "finance",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    RequesterEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    Reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Payee = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    BusinessLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    NeededBy = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    ApprovalRequestId = table.Column<Guid>(type: "uuid", nullable: true),
                    RejectReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    PaidEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    PaidAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_expense_requests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_expense_requests_business_lines_BusinessLineId",
                        column: x => x.BusinessLineId,
                        principalSchema: "finance",
                        principalTable: "business_lines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_expense_requests_categories_CategoryId",
                        column: x => x.CategoryId,
                        principalSchema: "finance",
                        principalTable: "categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ux_accounts_name",
                schema: "finance",
                table: "accounts",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_business_lines_code",
                schema: "finance",
                table: "business_lines",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_categories_kind_name",
                schema: "finance",
                table: "categories",
                columns: new[] { "Kind", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_entries_account",
                schema: "finance",
                table: "entries",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_entries_BusinessLineId",
                schema: "finance",
                table: "entries",
                column: "BusinessLineId");

            migrationBuilder.CreateIndex(
                name: "IX_entries_CategoryId",
                schema: "finance",
                table: "entries",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "ix_entries_date",
                schema: "finance",
                table: "entries",
                columns: new[] { "Date", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_entries_ToAccountId",
                schema: "finance",
                table: "entries",
                column: "ToAccountId");

            migrationBuilder.CreateIndex(
                name: "ux_entries_source",
                schema: "finance",
                table: "entries",
                columns: new[] { "SourceType", "SourceId" },
                unique: true,
                filter: "\"SourceId\" IS NOT NULL AND \"Status\" = 'Active'");

            migrationBuilder.CreateIndex(
                name: "IX_expense_requests_BusinessLineId",
                schema: "finance",
                table: "expense_requests",
                column: "BusinessLineId");

            migrationBuilder.CreateIndex(
                name: "IX_expense_requests_CategoryId",
                schema: "finance",
                table: "expense_requests",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "ix_expense_requests_requester",
                schema: "finance",
                table: "expense_requests",
                column: "RequesterEmployeeId");

            migrationBuilder.CreateIndex(
                name: "ix_expense_requests_status",
                schema: "finance",
                table: "expense_requests",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "ux_expense_requests_number",
                schema: "finance",
                table: "expense_requests",
                column: "Number",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "entries",
                schema: "finance");

            migrationBuilder.DropTable(
                name: "expense_requests",
                schema: "finance");

            migrationBuilder.DropTable(
                name: "settings",
                schema: "finance");

            migrationBuilder.DropTable(
                name: "accounts",
                schema: "finance");

            migrationBuilder.DropTable(
                name: "business_lines",
                schema: "finance");

            migrationBuilder.DropTable(
                name: "categories",
                schema: "finance");
        }
    }
}
