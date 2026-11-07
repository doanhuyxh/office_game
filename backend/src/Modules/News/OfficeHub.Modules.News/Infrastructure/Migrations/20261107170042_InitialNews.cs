using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace OfficeHub.Modules.News.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialNews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "news");

            migrationBuilder.CreateTable(
                name: "comments",
                schema: "news",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Seq = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    PostId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    AuthorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Text = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    ImageKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ImageName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    ImageContentType = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    EditedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    HiddenAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    HiddenReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    HiddenByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ReactionCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_comments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "feed_states",
                schema: "news",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LastSeenSeq = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_feed_states", x => x.UserId);
                });

            migrationBuilder.CreateTable(
                name: "mentions",
                schema: "news",
                columns: table => new
                {
                    TargetType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    TargetId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mentions", x => new { x.TargetType, x.TargetId, x.UserId });
                });

            migrationBuilder.CreateTable(
                name: "posts",
                schema: "news",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Seq = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    AuthorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ContentHtml = table.Column<string>(type: "text", nullable: false),
                    PlainText = table.Column<string>(type: "text", nullable: false),
                    Audience = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CommentsDisabled = table.Column<bool>(type: "boolean", nullable: false),
                    SendEmail = table.Column<bool>(type: "boolean", nullable: false),
                    PinnedUntil = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    EditedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    HiddenAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    HiddenReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    HiddenByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ReactionCount = table.Column<int>(type: "integer", nullable: false),
                    CommentCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_posts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "reactions",
                schema: "news",
                columns: table => new
                {
                    TargetType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    TargetId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_reactions", x => new { x.TargetType, x.TargetId, x.UserId });
                });

            migrationBuilder.CreateTable(
                name: "upload_tickets",
                schema: "news",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    FileKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    FileName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_upload_tickets", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "post_media",
                schema: "news",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PostId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    FileKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    FileName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_post_media", x => x.Id);
                    table.ForeignKey(
                        name: "FK_post_media_posts_PostId",
                        column: x => x.PostId,
                        principalSchema: "news",
                        principalTable: "posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "post_targets",
                schema: "news",
                columns: table => new
                {
                    PostId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    TargetId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_post_targets", x => new { x.PostId, x.Kind, x.TargetId });
                    table.ForeignKey(
                        name: "FK_post_targets_posts_PostId",
                        column: x => x.PostId,
                        principalSchema: "news",
                        principalTable: "posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_comments_parent",
                schema: "news",
                table: "comments",
                column: "ParentId");

            migrationBuilder.CreateIndex(
                name: "ix_comments_post_seq",
                schema: "news",
                table: "comments",
                columns: new[] { "PostId", "Seq" });

            migrationBuilder.CreateIndex(
                name: "ux_comments_seq",
                schema: "news",
                table: "comments",
                column: "Seq",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_post_media_post",
                schema: "news",
                table: "post_media",
                column: "PostId");

            migrationBuilder.CreateIndex(
                name: "ix_post_targets_target",
                schema: "news",
                table: "post_targets",
                columns: new[] { "Kind", "TargetId" });

            migrationBuilder.CreateIndex(
                name: "ix_posts_author",
                schema: "news",
                table: "posts",
                column: "AuthorUserId");

            migrationBuilder.CreateIndex(
                name: "ix_posts_pinned",
                schema: "news",
                table: "posts",
                column: "PinnedUntil",
                filter: "\"PinnedUntil\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ux_posts_seq",
                schema: "news",
                table: "posts",
                column: "Seq",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_reactions_user",
                schema: "news",
                table: "reactions",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "ix_upload_tickets_created",
                schema: "news",
                table: "upload_tickets",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "comments",
                schema: "news");

            migrationBuilder.DropTable(
                name: "feed_states",
                schema: "news");

            migrationBuilder.DropTable(
                name: "mentions",
                schema: "news");

            migrationBuilder.DropTable(
                name: "post_media",
                schema: "news");

            migrationBuilder.DropTable(
                name: "post_targets",
                schema: "news");

            migrationBuilder.DropTable(
                name: "reactions",
                schema: "news");

            migrationBuilder.DropTable(
                name: "upload_tickets",
                schema: "news");

            migrationBuilder.DropTable(
                name: "posts",
                schema: "news");
        }
    }
}
