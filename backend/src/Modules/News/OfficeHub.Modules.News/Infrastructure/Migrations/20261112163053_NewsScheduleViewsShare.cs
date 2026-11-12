using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.News.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class NewsScheduleViewsShare : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PublishAt",
                schema: "news",
                table: "posts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SharedPostId",
                schema: "news",
                table: "posts",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "post_views",
                schema: "news",
                columns: table => new
                {
                    PostId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ViewedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_post_views", x => new { x.PostId, x.UserId });
                });

            migrationBuilder.CreateIndex(
                name: "ix_posts_scheduled",
                schema: "news",
                table: "posts",
                column: "PublishAt",
                filter: "\"PublishAt\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_posts_shared",
                schema: "news",
                table: "posts",
                column: "SharedPostId",
                filter: "\"SharedPostId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "post_views",
                schema: "news");

            migrationBuilder.DropIndex(
                name: "ix_posts_scheduled",
                schema: "news",
                table: "posts");

            migrationBuilder.DropIndex(
                name: "ix_posts_shared",
                schema: "news",
                table: "posts");

            migrationBuilder.DropColumn(
                name: "PublishAt",
                schema: "news",
                table: "posts");

            migrationBuilder.DropColumn(
                name: "SharedPostId",
                schema: "news",
                table: "posts");
        }
    }
}
