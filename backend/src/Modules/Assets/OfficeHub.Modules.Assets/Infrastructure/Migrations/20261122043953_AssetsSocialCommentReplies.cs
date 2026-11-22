using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Assets.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AssetsSocialCommentReplies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "social_comment_replies",
                schema: "assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PagePostId = table.Column<Guid>(type: "uuid", nullable: false),
                    FacebookCommentId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ReplyFacebookId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Message = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: false),
                    ByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_social_comment_replies", x => x.Id);
                    table.ForeignKey(
                        name: "FK_social_comment_replies_social_page_posts_PagePostId",
                        column: x => x.PagePostId,
                        principalSchema: "assets",
                        principalTable: "social_page_posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_social_comment_replies_comment_user",
                schema: "assets",
                table: "social_comment_replies",
                columns: new[] { "FacebookCommentId", "ByUserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "ix_social_comment_replies_post",
                schema: "assets",
                table: "social_comment_replies",
                column: "PagePostId");

            migrationBuilder.CreateIndex(
                name: "ix_social_comment_replies_reply",
                schema: "assets",
                table: "social_comment_replies",
                column: "ReplyFacebookId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "social_comment_replies",
                schema: "assets");
        }
    }
}
