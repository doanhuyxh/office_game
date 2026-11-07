using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Approval.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ApprovalDelegation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "OnBehalfOfEmployeeId",
                schema: "approval",
                table: "steps",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OnBehalfOfName",
                schema: "approval",
                table: "steps",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "delegations",
                schema: "approval",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DelegatorEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    DelegateEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    FromDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ToDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RevokedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    RevokedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_delegations", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_delegations_DelegateEmployeeId_ToDate",
                schema: "approval",
                table: "delegations",
                columns: new[] { "DelegateEmployeeId", "ToDate" });

            migrationBuilder.CreateIndex(
                name: "IX_delegations_DelegatorEmployeeId_ToDate",
                schema: "approval",
                table: "delegations",
                columns: new[] { "DelegatorEmployeeId", "ToDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "delegations",
                schema: "approval");

            migrationBuilder.DropColumn(
                name: "OnBehalfOfEmployeeId",
                schema: "approval",
                table: "steps");

            migrationBuilder.DropColumn(
                name: "OnBehalfOfName",
                schema: "approval",
                table: "steps");
        }
    }
}
