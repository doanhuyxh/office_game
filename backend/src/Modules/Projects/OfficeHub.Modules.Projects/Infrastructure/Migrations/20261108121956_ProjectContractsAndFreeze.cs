using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Projects.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ProjectContractsAndFreeze : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<decimal>(
                name: "Percent",
                schema: "projects",
                table: "allocations",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.CreateTable(
                name: "allocation_freezes",
                schema: "projects",
                columns: table => new
                {
                    Month = table.Column<DateOnly>(type: "date", nullable: false),
                    FrozenAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_allocation_freezes", x => x.Month);
                });

            migrationBuilder.CreateTable(
                name: "contracts",
                schema: "projects",
                columns: table => new
                {
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    LinkedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contracts", x => new { x.ProjectId, x.ContractId });
                    table.ForeignKey(
                        name: "FK_contracts_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalSchema: "projects",
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Chép liên kết cũ (projects.SalesContractId) sang bảng mới TRƯỚC khi xoá cột. Một hợp đồng chỉ thuộc một dự án:
            // nếu dữ liệu cũ có hợp đồng gắn nhiều dự án → giữ dự án tạo sớm nhất.
            migrationBuilder.Sql("""
                INSERT INTO projects.contracts ("ProjectId", "ContractId", "LinkedAt")
                SELECT DISTINCT ON ("SalesContractId") "Id", "SalesContractId", COALESCE("UpdatedAt", "CreatedAt")
                FROM projects.projects
                WHERE "SalesContractId" IS NOT NULL
                ORDER BY "SalesContractId", "CreatedAt";
                """);

            migrationBuilder.CreateIndex(
                name: "ux_project_contracts_contract",
                schema: "projects",
                table: "contracts",
                column: "ContractId",
                unique: true);

            migrationBuilder.DropIndex(
                name: "ix_projects_contract",
                schema: "projects",
                table: "projects");

            migrationBuilder.DropColumn(
                name: "SalesContractId",
                schema: "projects",
                table: "projects");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "allocation_freezes",
                schema: "projects");

            migrationBuilder.AddColumn<Guid>(
                name: "SalesContractId",
                schema: "projects",
                table: "projects",
                type: "uuid",
                nullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "Percent",
                schema: "projects",
                table: "allocations",
                type: "integer",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(5,2)",
                oldPrecision: 5,
                oldScale: 2);

            migrationBuilder.CreateIndex(
                name: "ix_projects_contract",
                schema: "projects",
                table: "projects",
                column: "SalesContractId");

            // Rollback: chép lại liên kết (mỗi dự án lấy hợp đồng gắn sớm nhất) rồi mới xoá bảng mới.
            migrationBuilder.Sql("""
                UPDATE projects.projects p SET "SalesContractId" = c."ContractId"
                FROM (SELECT DISTINCT ON ("ProjectId") "ProjectId", "ContractId" FROM projects.contracts ORDER BY "ProjectId", "LinkedAt") c
                WHERE c."ProjectId" = p."Id";
                """);

            migrationBuilder.DropTable(
                name: "contracts",
                schema: "projects");
        }
    }
}
