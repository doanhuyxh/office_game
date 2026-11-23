using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Assets.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AssetsSocialPostSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeletedAt",
                schema: "assets",
                table: "social_posts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeletedByName",
                schema: "assets",
                table: "social_posts",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeletedAt",
                schema: "assets",
                table: "social_posts");

            migrationBuilder.DropColumn(
                name: "DeletedByName",
                schema: "assets",
                table: "social_posts");
        }
    }
}
