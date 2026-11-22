using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Assets.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AssetsSocialPagePostModeration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeletedAt",
                schema: "assets",
                table: "social_page_posts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeletedByName",
                schema: "assets",
                table: "social_page_posts",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "HiddenAt",
                schema: "assets",
                table: "social_page_posts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HiddenByName",
                schema: "assets",
                table: "social_page_posts",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsHidden",
                schema: "assets",
                table: "social_page_posts",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeletedAt",
                schema: "assets",
                table: "social_page_posts");

            migrationBuilder.DropColumn(
                name: "DeletedByName",
                schema: "assets",
                table: "social_page_posts");

            migrationBuilder.DropColumn(
                name: "HiddenAt",
                schema: "assets",
                table: "social_page_posts");

            migrationBuilder.DropColumn(
                name: "HiddenByName",
                schema: "assets",
                table: "social_page_posts");

            migrationBuilder.DropColumn(
                name: "IsHidden",
                schema: "assets",
                table: "social_page_posts");
        }
    }
}
