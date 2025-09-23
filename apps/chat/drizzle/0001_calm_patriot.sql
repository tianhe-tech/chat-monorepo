ALTER TABLE "chat"."messages" DROP CONSTRAINT "messages_thread_id_threads_id_fk";
--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "chat"."threads"("id") ON DELETE cascade ON UPDATE no action;