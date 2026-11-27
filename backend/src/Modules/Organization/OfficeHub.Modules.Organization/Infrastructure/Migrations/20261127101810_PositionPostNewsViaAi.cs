using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Organization.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PositionPostNewsViaAi : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "PostNewsViaAi",
                schema: "org",
                table: "positions",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PostNewsViaAi",
                schema: "org",
                table: "positions");
        }
    }
}
