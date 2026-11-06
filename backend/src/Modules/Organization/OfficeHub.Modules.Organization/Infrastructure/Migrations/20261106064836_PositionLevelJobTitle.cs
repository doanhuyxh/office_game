using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Organization.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PositionLevelJobTitle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Level",
                schema: "org",
                table: "positions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "JobTitle",
                schema: "org",
                table: "employees",
                type: "character varying(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_positions_Level",
                schema: "org",
                table: "positions",
                column: "Level");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_positions_Level",
                schema: "org",
                table: "positions");

            migrationBuilder.DropColumn(
                name: "Level",
                schema: "org",
                table: "positions");

            migrationBuilder.DropColumn(
                name: "JobTitle",
                schema: "org",
                table: "employees");
        }
    }
}
