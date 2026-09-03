import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";

/**
 * A minimal SMTP sink, for tests only.
 *
 * Enough of RFC 5321 for nodemailer to complete a session: greeting, EHLO,
 * MAIL FROM, RCPT TO, DATA, QUIT. It captures what was actually sent so a test
 * can assert on the envelope and the message, and it can be told to reject at a
 * chosen step to exercise the failure path.
 *
 * This is verification scaffolding, not product code.
 */

export type CapturedMail = {
  from: string;
  to: string[];
  data: string;
};

export class SmtpSink {
  private server: Server | null = null;
  readonly received: CapturedMail[] = [];

  /** When set, the server refuses at that command with a 5xx. */
  rejectAt: "MAIL" | "RCPT" | "DATA" | null = null;

  async start(): Promise<number> {
    this.server = createServer((socket: Socket) => this.session(socket));

    await new Promise<void>((resolve) => {
      this.server!.listen(0, "127.0.0.1", resolve);
    });

    return (this.server!.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
    });
    this.server = null;
  }

  private session(socket: Socket): void {
    let buffer = "";
    let inData = false;
    let current: CapturedMail = { from: "", to: [], data: "" };

    socket.write("220 sink.test ESMTP ready\r\n");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      let index = buffer.indexOf("\r\n");
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            this.received.push(current);
            current = { from: "", to: [], data: "" };
            socket.write("250 2.0.0 Ok: queued\r\n");
          } else {
            // Undo dot-stuffing, as a real server would.
            current.data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
          }
        } else {
          const upper = line.toUpperCase();

          if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
            socket.write("250-sink.test\r\n250 8BITMIME\r\n");
          } else if (upper.startsWith("MAIL FROM")) {
            if (this.rejectAt === "MAIL") {
              socket.write("550 5.1.8 Sender rejected\r\n");
            } else {
              current.from = extractAddress(line);
              socket.write("250 2.1.0 Ok\r\n");
            }
          } else if (upper.startsWith("RCPT TO")) {
            if (this.rejectAt === "RCPT") {
              socket.write("550 5.1.1 No such mailbox\r\n");
            } else {
              current.to.push(extractAddress(line));
              socket.write("250 2.1.5 Ok\r\n");
            }
          } else if (upper === "DATA") {
            if (this.rejectAt === "DATA") {
              socket.write("554 5.3.0 Message refused\r\n");
            } else {
              inData = true;
              socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
            }
          } else if (upper === "QUIT") {
            socket.write("221 2.0.0 Bye\r\n");
            socket.end();
          } else if (upper === "RSET") {
            current = { from: "", to: [], data: "" };
            socket.write("250 2.0.0 Ok\r\n");
          } else {
            socket.write("250 2.0.0 Ok\r\n");
          }
        }

        index = buffer.indexOf("\r\n");
      }
    });

    socket.on("error", () => {
      // A client hanging up mid-session is not a test failure.
    });
  }

  /** The most recent message, decoded far enough to assert on. */
  last(): { to: string[]; subject: string; body: string } | null {
    const mail = this.received.at(-1);
    if (!mail) return null;

    const subjectLine = /^Subject: (.*)$/m.exec(mail.data);
    return {
      to: mail.to,
      subject: subjectLine ? decodeHeader(subjectLine[1] as string) : "",
      body: mail.data,
    };
  }

  clear(): void {
    this.received.length = 0;
  }
}

function extractAddress(line: string): string {
  const match = /<([^>]*)>/.exec(line);
  return match ? (match[1] as string) : line.split(":").slice(1).join(":").trim();
}

/** Undo RFC 2047 encoded-words, which nodemailer uses for non-ASCII subjects. */
function decodeHeader(value: string): string {
  return value.replace(/=\?utf-8\?B\?([^?]+)\?=/gi, (_match, base64: string) =>
    Buffer.from(base64, "base64").toString("utf8"),
  );
}
