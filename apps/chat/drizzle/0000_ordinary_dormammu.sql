CREATE SCHEMA "chat";
--> statement-breakpoint
CREATE TYPE "chat"."message_format" AS ENUM('ai_v5', 'mastra_v2');--> statement-breakpoint
CREATE TYPE "chat"."role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "chat"."messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"role" "chat"."role" NOT NULL,
	"format" "chat"."message_format" NOT NULL,
	"content" json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat"."threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "chat"."threads"("id") ON DELETE cascade ON UPDATE no action;