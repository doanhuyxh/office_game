using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Projects.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TaskDependencies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "task_dependencies",
                schema: "projects",
                columns: table => new
                {
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    DependsOnId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_task_dependencies", x => new { x.TaskId, x.DependsOnId });
                    table.ForeignKey(
                        name: "FK_task_dependencies_tasks_DependsOnId",
                        column: x => x.DependsOnId,
                        principalSchema: "projects",
                        principalTable: "tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_task_dependencies_tasks_TaskId",
                        column: x => x.TaskId,
                        principalSchema: "projects",
                        principalTable: "tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_task_dependencies_on",
                schema: "projects",
                table: "task_dependencies",
                column: "DependsOnId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "task_dependencies",
                schema: "projects");
        }
    }
}
