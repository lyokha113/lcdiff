package dev.ldiff.sidecar;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintWriter;
import java.io.PrintStream;
import java.io.StringWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.benf.cfr.reader.api.CfrDriver;
import org.benf.cfr.reader.api.OutputSinkFactory;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.util.Textifier;
import org.objectweb.asm.util.TraceClassVisitor;

public final class SidecarMain {
  private static final int MAX_FRAME_SIZE = 32 * 1024 * 1024;
  private static final ObjectMapper JSON = new ObjectMapper();

  private SidecarMain() {}

  public static void main(String[] args) throws IOException {
    DataInputStream input = new DataInputStream(new BufferedInputStream(System.in));
    DataOutputStream output = new DataOutputStream(new BufferedOutputStream(System.out));
    while (true) {
      try {
        ObjectNode request = readFrame(input);
        writeFrame(output, handle(request));
      } catch (EOFException eof) {
        return;
      }
    }
  }

  private static ObjectNode handle(ObjectNode request) {
    String id = request.path("id").asText("");
    try {
      String action = request.path("action").asText();
      if ("ping".equals(action)) return ok(id);
      if ("cancel".equals(action)) return ok(id);
      Path archive = firstClasspath(request);
      String entry = requiredText(request, "entry");
      byte[] bytes = readEntry(archive, entry);
      if ("disassemble".equals(action)) {
        return ok(id).put("source", disassemble(bytes));
      }
      if ("decompile".equals(action)) {
        String engine = request.path("engine").asText("vineflower");
        String source =
            "vineflower".equals(engine)
                ? decompileVineflower(archive, entry, bytes)
                : decompileCfr(archive, entry, bytes);
        return ok(id).put("source", source);
      }
      return error(id, "NotFound", "unknown action: " + action, "none");
    } catch (Exception exception) {
      return error(id, "EngineError", rootMessage(exception), "bytecode");
    }
  }

  private static String decompileCfr(Path archive, String entry, byte[] bytes) throws IOException {
    Path root = Files.createTempDirectory("ldiff-cfr-");
    try {
      Path classFile = writeClass(root, entry, bytes);
      final StringBuilder source = new StringBuilder();
      Map<String, String> options = new HashMap<String, String>();
      options.put("extraclasspath", archive.toString());
      options.put("silent", "true");
      CfrDriver driver =
          new CfrDriver.Builder()
              .withOptions(options)
              .withOutputSink(
                  new OutputSinkFactory() {
                    @Override
                    public List<SinkClass> getSupportedSinks(
                        SinkType sinkType, Collection<SinkClass> available) {
                      return Collections.singletonList(SinkClass.STRING);
                    }

                    @Override
                    public <T> Sink<T> getSink(SinkType sinkType, SinkClass sinkClass) {
                      return value -> {
                        if (sinkType == SinkType.JAVA) source.append(value);
                      };
                    }
                  })
              .build();
      driver.analyse(Collections.singletonList(classFile.toString()));
      if (source.length() == 0) throw new IOException("CFR returned no source");
      return source.toString();
    } finally {
      deleteTree(root);
    }
  }

  private static String decompileVineflower(Path archive, String entry, byte[] bytes)
      throws Exception {
    Path root = Files.createTempDirectory("ldiff-vineflower-");
    Path destination = Files.createDirectory(root.resolve("out"));
    try {
      Path classFile = writeClass(root, entry, bytes);
      Class<?> cli = Class.forName("org.jetbrains.java.decompiler.main.decompiler.ConsoleDecompiler");
      Method main = cli.getMethod("main", String[].class);
      String[] args = {classFile.toString(), destination.toString()};
      PrintStream stdout = System.out;
      try {
        System.setOut(new PrintStream(new ByteArrayOutputStream()));
        main.invoke(null, (Object) args);
      } finally {
        System.setOut(stdout);
      }
      try (Stream<Path> files = Files.walk(destination)) {
        Path javaFile =
            files.filter(path -> path.getFileName().toString().endsWith(".java"))
                .findFirst()
                .orElseThrow(() -> new IOException("Vineflower returned no source"));
        return new String(Files.readAllBytes(javaFile), "UTF-8");
      }
    } catch (InvocationTargetException exception) {
      throw new IOException(rootMessage(exception.getCause()), exception);
    } finally {
      deleteTree(root);
    }
  }

  private static String disassemble(byte[] bytes) {
    StringWriter output = new StringWriter();
    new ClassReader(bytes)
        .accept(new TraceClassVisitor(null, new Textifier(), new PrintWriter(output)), 0);
    return output.toString();
  }

  private static Path firstClasspath(JsonNode request) throws IOException {
    JsonNode classpath = request.path("classpath");
    if (!classpath.isArray() || classpath.size() == 0) {
      throw new IOException("classpath must contain the source archive");
    }
    return Paths.get(classpath.get(0).asText());
  }

  private static String requiredText(JsonNode request, String field) throws IOException {
    String value = request.path(field).asText("");
    if (value.isEmpty()) throw new IOException(field + " is required");
    return value;
  }

  private static byte[] readEntry(Path archive, String entry) throws IOException {
    try (ZipFile zip = new ZipFile(archive.toFile())) {
      ZipEntry zipEntry = zip.getEntry(entry);
      if (zipEntry == null) throw new IOException("entry not found: " + entry);
      return readAllBytes(zip.getInputStream(zipEntry));
    }
  }

  private static byte[] readAllBytes(InputStream input) throws IOException {
    try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[8192];
      int count;
      while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
      return output.toByteArray();
    }
  }

  private static Path writeClass(Path root, String entry, byte[] bytes) throws IOException {
    Path path = root.resolve(entry).normalize();
    if (!path.startsWith(root)) throw new IOException("entry escapes temporary directory");
    Files.createDirectories(path.getParent());
    Files.write(path, bytes);
    return path;
  }

  private static ObjectNode ok(String id) {
    ObjectNode response = JSON.createObjectNode();
    response.put("id", id);
    response.put("ok", true);
    response.set("warnings", JSON.createArrayNode());
    return response;
  }

  private static ObjectNode error(String id, String kind, String message, String fallback) {
    ObjectNode response = JSON.createObjectNode();
    response.put("id", id);
    response.put("ok", false);
    response.put("errorKind", kind);
    response.put("message", message);
    response.put("fallback", fallback);
    return response;
  }

  private static ObjectNode readFrame(DataInputStream input) throws IOException {
    int length = input.readInt();
    if (length < 0 || length > MAX_FRAME_SIZE) throw new IOException("invalid frame length");
    byte[] bytes = new byte[length];
    input.readFully(bytes);
    return (ObjectNode) JSON.readTree(bytes);
  }

  private static void writeFrame(DataOutputStream output, ObjectNode response) throws IOException {
    byte[] bytes = JSON.writeValueAsBytes(response);
    output.writeInt(bytes.length);
    output.write(bytes);
    output.flush();
  }

  private static void deleteTree(Path root) {
    if (root == null) return;
    try (Stream<Path> files = Files.walk(root)) {
      files.sorted((left, right) -> right.compareTo(left))
          .forEach(path -> {
            try {
              Files.deleteIfExists(path);
            } catch (IOException ignored) {
              // Best-effort cleanup only.
            }
          });
    } catch (IOException ignored) {
      // Best-effort cleanup only.
    }
  }

  private static String rootMessage(Throwable exception) {
    Throwable current = exception;
    while (current.getCause() != null) current = current.getCause();
    return current.getMessage() == null ? current.toString() : current.getMessage();
  }
}
