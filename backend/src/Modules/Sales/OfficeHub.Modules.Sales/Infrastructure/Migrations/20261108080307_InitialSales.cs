using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace OfficeHub.Modules.Sales.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialSales : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "sales");

            migrationBuilder.CreateTable(
                name: "customers",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Kind = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    TaxCode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Address = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    Phone = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Source = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    OwnerEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_customers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "activities",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: false),
                    OpportunityId = table.Column<Guid>(type: "uuid", nullable: true),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Content = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    NextAction = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    NextActionOn = table.Column<DateOnly>(type: "date", nullable: true),
                    NextActionRemindedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedByEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_activities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_activities_customers_CustomerId",
                        column: x => x.CustomerId,
                        principalSchema: "sales",
                        principalTable: "customers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "contacts",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Title = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Phone = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    IsPrimary = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contacts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_contacts_customers_CustomerId",
                        column: x => x.CustomerId,
                        principalSchema: "sales",
                        principalTable: "customers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "opportunities",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    BusinessLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    Stage = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    Value = table.Column<long>(type: "bigint", nullable: false),
                    Probability = table.Column<int>(type: "integer", nullable: false),
                    ExpectedCloseOn = table.Column<DateOnly>(type: "date", nullable: true),
                    LostReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    OwnerEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ClosedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opportunities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_opportunities_customers_CustomerId",
                        column: x => x.CustomerId,
                        principalSchema: "sales",
                        principalTable: "customers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "contracts",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: false),
                    OpportunityId = table.Column<Guid>(type: "uuid", nullable: true),
                    BusinessLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    Title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    ValueBeforeTax = table.Column<long>(type: "bigint", nullable: false),
                    VatRate = table.Column<int>(type: "integer", nullable: false),
                    TotalValue = table.Column<long>(type: "bigint", nullable: false),
                    SignedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    EndOn = table.Column<DateOnly>(type: "date", nullable: true),
                    Billing = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    OwnerEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contracts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_contracts_customers_CustomerId",
                        column: x => x.CustomerId,
                        principalSchema: "sales",
                        principalTable: "customers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_contracts_opportunities_OpportunityId",
                        column: x => x.OpportunityId,
                        principalSchema: "sales",
                        principalTable: "opportunities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "installments",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    DueOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    Cancelled = table.Column<bool>(type: "boolean", nullable: false),
                    CancelReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    RemindedSoonAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RemindedDueAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastOverdueRemindOn = table.Column<DateOnly>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_installments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_installments_contracts_ContractId",
                        column: x => x.ContractId,
                        principalSchema: "sales",
                        principalTable: "contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "collections",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InstallmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    LedgerEntryId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_collections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_collections_installments_InstallmentId",
                        column: x => x.InstallmentId,
                        principalSchema: "sales",
                        principalTable: "installments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_activities_customer",
                schema: "sales",
                table: "activities",
                columns: new[] { "CustomerId", "At" });

            migrationBuilder.CreateIndex(
                name: "ix_activities_next",
                schema: "sales",
                table: "activities",
                column: "NextActionOn");

            migrationBuilder.CreateIndex(
                name: "IX_collections_InstallmentId",
                schema: "sales",
                table: "collections",
                column: "InstallmentId");

            migrationBuilder.CreateIndex(
                name: "IX_contacts_CustomerId",
                schema: "sales",
                table: "contacts",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "ix_contracts_customer",
                schema: "sales",
                table: "contracts",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_contracts_OpportunityId",
                schema: "sales",
                table: "contracts",
                column: "OpportunityId");

            migrationBuilder.CreateIndex(
                name: "ix_contracts_owner",
                schema: "sales",
                table: "contracts",
                column: "OwnerEmployeeId");

            migrationBuilder.CreateIndex(
                name: "ux_contracts_code",
                schema: "sales",
                table: "contracts",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_customers_owner",
                schema: "sales",
                table: "customers",
                column: "OwnerEmployeeId");

            migrationBuilder.CreateIndex(
                name: "ux_customers_number",
                schema: "sales",
                table: "customers",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_customers_tax_code",
                schema: "sales",
                table: "customers",
                column: "TaxCode",
                unique: true,
                filter: "\"TaxCode\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_installments_ContractId",
                schema: "sales",
                table: "installments",
                column: "ContractId");

            migrationBuilder.CreateIndex(
                name: "ix_installments_due",
                schema: "sales",
                table: "installments",
                column: "DueOn");

            migrationBuilder.CreateIndex(
                name: "ix_opportunities_customer",
                schema: "sales",
                table: "opportunities",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "ix_opportunities_owner",
                schema: "sales",
                table: "opportunities",
                columns: new[] { "OwnerEmployeeId", "Stage" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "activities",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "collections",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "contacts",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "installments",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "contracts",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "opportunities",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "customers",
                schema: "sales");
        }
    }
}
