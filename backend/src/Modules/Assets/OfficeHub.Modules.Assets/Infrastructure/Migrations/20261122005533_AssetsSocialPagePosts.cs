using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Assets.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AssetsSocialPagePosts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PostsSyncError",
                schema: "assets",
                table: "social_pages",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PostsSyncedAt",
                schema: "assets",
                table: "social_pages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "social_page_posts",
                schema: "assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PageId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExternalPostId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Message = table.Column<string>(type: "text", nullable: true),
                    CreatedTime = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Permalink = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    PictureUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    StatusType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    ReactionCount = table.Column<int>(type: "integer", nullable: false),
                    CommentCount = table.Column<int>(type: "integer", nullable: false),
                    ShareCount = table.Column<int>(type: "integer", nullable: false),
                    SyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    PostTargetId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_social_page_posts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_social_page_posts_social_pages_PageId",
                        column: x => x.PageId,
                        principalSchema: "assets",
                        principalTable: "social_pages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_social_page_posts_social_post_targets_PostTargetId",
                        column: x => x.PostTargetId,
                        principalSchema: "assets",
                        principalTable: "social_post_targets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "ix_social_page_posts_page_created",
                schema: "assets",
                table: "social_page_posts",
                columns: new[] { "PageId", "CreatedTime" });

            migrationBuilder.CreateIndex(
                name: "IX_social_page_posts_PostTargetId",
                schema: "assets",
                table: "social_page_posts",
                column: "PostTargetId");

            migrationBuilder.CreateIndex(
                name: "ux_social_page_posts_external",
                schema: "assets",
                table: "social_page_posts",
                columns: new[] { "PageId", "ExternalPostId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "social_page_posts",
                schema: "assets");

            migrationBuilder.DropColumn(
                name: "PostsSyncError",
                schema: "assets",
                table: "social_pages");

            migrationBuilder.DropColumn(
                name: "PostsSyncedAt",
                schema: "assets",
                table: "social_pages");
        }
    }
}
