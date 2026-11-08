using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Sales.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddContractAppendices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AppendixId",
                schema: "sales",
                table: "installments",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "contract_appendices",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    SignedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    ValueBeforeTaxDelta = table.Column<long>(type: "bigint", nullable: false),
                    TotalDelta = table.Column<long>(type: "bigint", nullable: false),
                    ChangeRequestId = table.Column<Guid>(type: "uuid", nullable: true),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Cancelled = table.Column<bool>(type: "boolean", nullable: false),
                    CancelReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contract_appendices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_contract_appendices_contracts_ContractId",
                        column: x => x.ContractId,
                        principalSchema: "sales",
                        principalTable: "contracts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_installments_AppendixId",
                schema: "sales",
                table: "installments",
                column: "AppendixId");

            migrationBuilder.CreateIndex(
                name: "ux_contract_appendices_code",
                schema: "sales",
                table: "contract_appendices",
                columns: new[] { "ContractId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_contract_appendices_cr",
                schema: "sales",
                table: "contract_appendices",
                column: "ChangeRequestId",
                unique: true,
                filter: "\"ChangeRequestId\" IS NOT NULL AND NOT \"Cancelled\"");

            migrationBuilder.AddForeignKey(
                name: "FK_installments_contract_appendices_AppendixId",
                schema: "sales",
                table: "installments",
                column: "AppendixId",
                principalSchema: "sales",
                principalTable: "contract_appendices",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_installments_contract_appendices_AppendixId",
                schema: "sales",
                table: "installments");

            migrationBuilder.DropTable(
                name: "contract_appendices",
                schema: "sales");

            migrationBuilder.DropIndex(
                name: "IX_installments_AppendixId",
                schema: "sales",
                table: "installments");

            migrationBuilder.DropColumn(
                name: "AppendixId",
                schema: "sales",
                table: "installments");
        }
    }
}
