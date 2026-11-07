using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Organization.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PositionSelfPublish : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "SelfPublishDocuments",
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
                name: "SelfPublishDocuments",
                schema: "org",
                table: "positions");
        }
    }
}
