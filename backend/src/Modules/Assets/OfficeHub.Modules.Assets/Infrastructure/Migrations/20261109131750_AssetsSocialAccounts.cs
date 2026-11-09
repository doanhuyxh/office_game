using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Assets.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AssetsSocialAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "social_accounts",
                schema: "assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Platform = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ExternalId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    LoginHint = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    OwnerDepartmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    HolderEmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    TokenEncrypted = table.Column<string>(type: "text", nullable: true),
                    TokenStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    TokenError = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    TokenCheckedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    TokenOwnerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    PagesSyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_social_accounts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "social_posts",
                schema: "assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Message = table.Column<string>(type: "text", nullable: false),
                    Link = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ScheduledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AuthorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorEmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    AuthorName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_social_posts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "social_account_assignments",
                schema: "assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssignedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AssignedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    AssignNote = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    ReturnedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ReturnedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ReturnNote = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_social_account_assignments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_social_account_assignments_social_accounts_AccountId",
                        column: x => x.AccountId,
                        principalSchema: "assets",
                        principalTable: "social_accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "social_pages",
                schema: "assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExternalId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Category = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Link = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    PictureUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    TokenEncrypted = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_social_pages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_social_pages_social_accounts_AccountId",
                        column: x => x.AccountId,
                        principalSchema: "assets",
                        principalTable: "social_accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "social_media",
                schema: "assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PostId = table.Column<Guid>(type: "uuid", nullable: true),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    FileName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    FileKey = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    Ready = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_social_media", x => x.Id);
                    table.ForeignKey(
                        name: "FK_social_media_social_posts_PostId",
                        column: x => x.PostId,
                        principalSchema: "assets",
                        principalTable: "social_posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "social_post_targets",
                schema: "assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PostId = table.Column<Guid>(type: "uuid", nullable: false),
                    PageId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DueAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PublishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ExternalPostId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Permalink = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Error = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CancelledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CancelledByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_social_post_targets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_social_post_targets_social_pages_PageId",
                        column: x => x.PageId,
                        principalSchema: "assets",
                        principalTable: "social_pages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_social_post_targets_social_posts_PostId",
                        column: x => x.PostId,
                        principalSchema: "assets",
                        principalTable: "social_posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_social_assignments_account",
                schema: "assets",
                table: "social_account_assignments",
                columns: new[] { "AccountId", "AssignedAt" });

            migrationBuilder.CreateIndex(
                name: "ix_social_assignments_employee",
                schema: "assets",
                table: "social_account_assignments",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "ix_social_accounts_holder",
                schema: "assets",
                table: "social_accounts",
                column: "HolderEmployeeId");

            migrationBuilder.CreateIndex(
                name: "ux_social_accounts_external",
                schema: "assets",
                table: "social_accounts",
                columns: new[] { "Platform", "ExternalId" },
                unique: true,
                filter: "\"ExternalId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_social_media_post",
                schema: "assets",
                table: "social_media",
                column: "PostId");

            migrationBuilder.CreateIndex(
                name: "ux_social_pages_account_external",
                schema: "assets",
                table: "social_pages",
                columns: new[] { "AccountId", "ExternalId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_social_post_targets_PostId",
                schema: "assets",
                table: "social_post_targets",
                column: "PostId");

            migrationBuilder.CreateIndex(
                name: "ix_social_targets_due",
                schema: "assets",
                table: "social_post_targets",
                columns: new[] { "Status", "DueAt" });

            migrationBuilder.CreateIndex(
                name: "ix_social_targets_page",
                schema: "assets",
                table: "social_post_targets",
                column: "PageId");

            migrationBuilder.CreateIndex(
                name: "ix_social_posts_author",
                schema: "assets",
                table: "social_posts",
                column: "AuthorUserId");

            migrationBuilder.CreateIndex(
                name: "ix_social_posts_created",
                schema: "assets",
                table: "social_posts",
                columns: new[] { "CreatedAt", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "social_account_assignments",
                schema: "assets");

            migrationBuilder.DropTable(
                name: "social_media",
                schema: "assets");

            migrationBuilder.DropTable(
                name: "social_post_targets",
                schema: "assets");

            migrationBuilder.DropTable(
                name: "social_pages",
                schema: "assets");

            migrationBuilder.DropTable(
                name: "social_posts",
                schema: "assets");

            migrationBuilder.DropTable(
                name: "social_accounts",
                schema: "assets");
        }
    }
}
