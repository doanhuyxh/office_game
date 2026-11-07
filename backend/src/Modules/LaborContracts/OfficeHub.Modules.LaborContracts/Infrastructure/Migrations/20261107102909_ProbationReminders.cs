using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.LaborContracts.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ProbationReminders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "OverdueRemindedAt",
                schema: "contracts",
                table: "contracts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "Reminded3At",
                schema: "contracts",
                table: "contracts",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OverdueRemindedAt",
                schema: "contracts",
                table: "contracts");

            migrationBuilder.DropColumn(
                name: "Reminded3At",
                schema: "contracts",
                table: "contracts");
        }
    }
}
