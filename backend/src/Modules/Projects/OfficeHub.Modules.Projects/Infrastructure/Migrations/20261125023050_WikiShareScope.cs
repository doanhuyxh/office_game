using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Projects.Infrastructure.Migrations
{
    /// <summary>
    /// TEST-230: link chia sẻ sổ tay theo phạm vi (toàn bộ sổ tay / chọn nhiều trang). Link cũ (một trang gốc + kèm con) chuyển thành
    /// Scope = pages với một dòng wiki_share_link_pages — token / URL không đổi, khách vẫn mở được.
    /// </summary>
    public partial class WikiShareScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "RootPageId",
                schema: "projects",
                table: "wiki_share_links",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "Scope",
                schema: "projects",
                table: "wiki_share_links",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "pages");

            migrationBuilder.CreateTable(
                name: "wiki_share_link_pages",
                schema: "projects",
                columns: table => new
                {
                    LinkId = table.Column<Guid>(type: "uuid", nullable: false),
                    PageId = table.Column<Guid>(type: "uuid", nullable: false),
                    IncludeChildren = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_wiki_share_link_pages", x => new { x.LinkId, x.PageId });
                    table.ForeignKey(
                        name: "FK_wiki_share_link_pages_wiki_pages_PageId",
                        column: x => x.PageId,
                        principalSchema: "projects",
                        principalTable: "wiki_pages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_wiki_share_link_pages_wiki_share_links_LinkId",
                        column: x => x.LinkId,
                        principalSchema: "projects",
                        principalTable: "wiki_share_links",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_wiki_share_link_pages_page",
                schema: "projects",
                table: "wiki_share_link_pages",
                column: "PageId");

            // Link cũ → phạm vi pages, một trang (trang gốc + cờ kèm con). Chép trước khi bỏ cột IncludeChildren.
            migrationBuilder.Sql("""
                INSERT INTO projects.wiki_share_link_pages ("LinkId", "PageId", "IncludeChildren")
                SELECT "Id", "RootPageId", "IncludeChildren" FROM projects.wiki_share_links WHERE "RootPageId" IS NOT NULL;
                """);

            migrationBuilder.DropColumn(
                name: "IncludeChildren",
                schema: "projects",
                table: "wiki_share_links");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IncludeChildren",
                schema: "projects",
                table: "wiki_share_links",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Quay lại một trang gốc / link: lấy trang được chọn đầu tiên; link không biểu diễn được (toàn bộ sổ tay, không trang) bị xoá.
            migrationBuilder.Sql("""
                UPDATE projects.wiki_share_links l SET "RootPageId" = p."PageId", "IncludeChildren" = p."IncludeChildren"
                FROM (SELECT DISTINCT ON ("LinkId") "LinkId", "PageId", "IncludeChildren" FROM projects.wiki_share_link_pages ORDER BY "LinkId", "PageId") p
                WHERE p."LinkId" = l."Id";
                DELETE FROM projects.wiki_share_links WHERE "RootPageId" IS NULL;
                """);

            migrationBuilder.DropTable(
                name: "wiki_share_link_pages",
                schema: "projects");

            migrationBuilder.DropColumn(
                name: "Scope",
                schema: "projects",
                table: "wiki_share_links");

            migrationBuilder.AlterColumn<Guid>(
                name: "RootPageId",
                schema: "projects",
                table: "wiki_share_links",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
