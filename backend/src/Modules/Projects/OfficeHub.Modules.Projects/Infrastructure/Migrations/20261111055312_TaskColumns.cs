using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Projects.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TaskColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "task_columns",
                schema: "projects",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    Color = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    IsDone = table.Column<bool>(type: "boolean", nullable: false),
                    ApproverOnly = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_task_columns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_task_columns_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalSchema: "projects",
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddColumn<Guid>(
                name: "ColumnId",
                schema: "projects",
                table: "tasks",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            // Dữ liệu cũ: mỗi dự án 4 cột mặc định (Xong = hoàn thành; cần người duyệt nếu dự án đang bật "Xong cần duyệt"), việc gán cột theo State cũ.
            migrationBuilder.Sql("""
                INSERT INTO projects.task_columns ("Id", "ProjectId", "Name", "Position", "Color", "IsDone", "ApproverOnly")
                SELECT gen_random_uuid(), p."Id", d.name, d.pos, d.color, d.done, d.done AND p."RequireReview"
                FROM projects.projects p
                CROSS JOIN (VALUES ('Cần làm', 0, '#64748b', false), ('Đang làm', 1, '#3b82f6', false),
                                   ('Chờ review', 2, '#f59e0b', false), ('Xong', 3, '#22c55e', true)) AS d(name, pos, color, done);
                UPDATE projects.tasks t SET "ColumnId" = c."Id"
                FROM projects.task_columns c
                WHERE c."ProjectId" = t."ProjectId"
                  AND c."Position" = CASE t."State" WHEN 'Todo' THEN 0 WHEN 'Doing' THEN 1 WHEN 'Review' THEN 2 ELSE 3 END;
                UPDATE projects.tasks t SET "CompletedAt" = NULL WHERE t."State" <> 'Done';
                """);

            migrationBuilder.DropIndex(
                name: "ix_tasks_assignee",
                schema: "projects",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "State",
                schema: "projects",
                table: "tasks");

            migrationBuilder.RenameColumn(
                name: "RequireReview",
                schema: "projects",
                table: "projects",
                newName: "Sequential");

            migrationBuilder.CreateIndex(
                name: "ix_tasks_assignee",
                schema: "projects",
                table: "tasks",
                columns: new[] { "AssigneeEmployeeId", "CompletedAt" });

            migrationBuilder.CreateIndex(
                name: "ix_tasks_column",
                schema: "projects",
                table: "tasks",
                column: "ColumnId");

            migrationBuilder.CreateIndex(
                name: "ix_task_columns_project",
                schema: "projects",
                table: "task_columns",
                columns: new[] { "ProjectId", "Position" });

            migrationBuilder.AddForeignKey(
                name: "FK_tasks_task_columns_ColumnId",
                schema: "projects",
                table: "tasks",
                column: "ColumnId",
                principalSchema: "projects",
                principalTable: "task_columns",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tasks_task_columns_ColumnId",
                schema: "projects",
                table: "tasks");

            migrationBuilder.AddColumn<string>(
                name: "State",
                schema: "projects",
                table: "tasks",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "Todo");

            // Gần đúng: cột hoàn thành → Done, còn lại theo vị trí (0 Todo, 1 Doing, ≥ 2 Review).
            migrationBuilder.Sql("""
                UPDATE projects.tasks t SET "State" = CASE WHEN c."IsDone" THEN 'Done' WHEN c."Position" = 0 THEN 'Todo' WHEN c."Position" = 1 THEN 'Doing' ELSE 'Review' END
                FROM projects.task_columns c WHERE c."Id" = t."ColumnId";
                """);

            migrationBuilder.DropTable(
                name: "task_columns",
                schema: "projects");

            migrationBuilder.DropIndex(
                name: "ix_tasks_assignee",
                schema: "projects",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "ix_tasks_column",
                schema: "projects",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "ColumnId",
                schema: "projects",
                table: "tasks");

            migrationBuilder.RenameColumn(
                name: "Sequential",
                schema: "projects",
                table: "projects",
                newName: "RequireReview");

            migrationBuilder.CreateIndex(
                name: "ix_tasks_assignee",
                schema: "projects",
                table: "tasks",
                columns: new[] { "AssigneeEmployeeId", "State" });
        }
    }
}
