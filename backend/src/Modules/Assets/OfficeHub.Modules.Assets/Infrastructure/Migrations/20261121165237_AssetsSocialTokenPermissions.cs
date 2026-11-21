using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Assets.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AssetsSocialTokenPermissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TokenPermissions",
                schema: "assets",
                table: "social_accounts",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TokenPermissionsError",
                schema: "assets",
                table: "social_accounts",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TokenPermissions",
                schema: "assets",
                table: "social_accounts");

            migrationBuilder.DropColumn(
                name: "TokenPermissionsError",
                schema: "assets",
                table: "social_accounts");
        }
    }
}
