using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Documents.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DocumentSettingsAutoPublish : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AutoPublished",
                schema: "documents",
                table: "assets",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "settings",
                schema: "documents",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    RequirePublishApproval = table.Column<bool>(type: "boolean", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_settings", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "settings",
                schema: "documents");

            migrationBuilder.DropColumn(
                name: "AutoPublished",
                schema: "documents",
                table: "assets");
        }
    }
}
