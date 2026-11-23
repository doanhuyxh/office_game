using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Finance.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCashForecast : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PayrollPayDay",
                schema: "finance",
                table: "settings",
                type: "integer",
                nullable: false,
                defaultValue: 10);

            migrationBuilder.AddColumn<int>(
                name: "PipelineDelayDays",
                schema: "finance",
                table: "settings",
                type: "integer",
                nullable: false,
                defaultValue: 30);

            migrationBuilder.CreateTable(
                name: "recurring_items",
                schema: "finance",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    DayOfMonth = table.Column<int>(type: "integer", nullable: false),
                    BusinessLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_recurring_items", x => x.Id);
                    table.ForeignKey(
                        name: "FK_recurring_items_business_lines_BusinessLineId",
                        column: x => x.BusinessLineId,
                        principalSchema: "finance",
                        principalTable: "business_lines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_recurring_items_BusinessLineId",
                schema: "finance",
                table: "recurring_items",
                column: "BusinessLineId");

            migrationBuilder.CreateIndex(
                name: "ux_recurring_items_name",
                schema: "finance",
                table: "recurring_items",
                column: "Name",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "recurring_items",
                schema: "finance");

            migrationBuilder.DropColumn(
                name: "PayrollPayDay",
                schema: "finance",
                table: "settings");

            migrationBuilder.DropColumn(
                name: "PipelineDelayDays",
                schema: "finance",
                table: "settings");
        }
    }
}
