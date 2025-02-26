import { App, Stack, NestedStack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import {
  Datadog,
  DD_ACCOUNT_ID,
  FLUSH_METRICS_TO_LOGS_ENV_VAR,
  ENABLE_DD_TRACING_ENV_VAR,
  INJECT_LOG_CONTEXT_ENV_VAR,
  ENABLE_DD_LOGS_ENV_VAR,
  CAPTURE_LAMBDA_PAYLOAD_ENV_VAR,
  JS_HANDLER_WITH_LAYERS,
  DD_HANDLER_ENV_VAR,
  PYTHON_HANDLER,
  JS_HANDLER,
} from "../src/index";
import { findDatadogSubscriptionFilters } from "./test-utils";

describe("addLambdaFunctions", () => {
  it("Subscribes the same forwarder to two different lambda functions via separate addLambdaFunctions function calls", () => {
    const app = new App();
    const stack = new Stack(app, "stack", {
      env: {
        region: "sa-east-1",
      },
    });
    const nodeLambda = new lambda.Function(stack, "NodeHandler", {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset("test"),
      handler: "hello.handler",
    });
    const pythonLambda = new lambda.Function(stack, "PythonHandler", {
      runtime: lambda.Runtime.PYTHON_3_7,
      code: lambda.Code.fromAsset("test"),
      handler: "hello.handler",
    });
    const datadogCdk = new Datadog(stack, "Datadog", {
      nodeLayerVersion: 20,
      pythonLayerVersion: 28,
      addLayers: true,
      forwarderArn: "arn:test:forwarder:sa-east-1:12345678:1",
      enableDatadogTracing: true,
      enableDatadogLogs: true,
      flushMetricsToLogs: true,
      site: "datadoghq.com",
    });
    datadogCdk.addLambdaFunctions([nodeLambda]);
    datadogCdk.addLambdaFunctions([pythonLambda]);

    const nodeLambdaSubscriptionFilters = findDatadogSubscriptionFilters(nodeLambda);
    const pythonLambdaSubscriptionFilters = findDatadogSubscriptionFilters(pythonLambda);
    expect(nodeLambdaSubscriptionFilters).toHaveLength(1);
    expect(pythonLambdaSubscriptionFilters).toHaveLength(1);
    expect(nodeLambdaSubscriptionFilters[0].destinationArn).toEqual(pythonLambdaSubscriptionFilters[0].destinationArn);
  });

  it("Throws an error when a customer redundantly calls the addLambdaFunctions function on the same lambda function(s) and forwarder", () => {
    const app = new App();
    const stack = new Stack(app, "stack", {
      env: {
        region: "sa-east-1",
      },
    });
    const nodeLambda = new lambda.Function(stack, "NodeHandler", {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset("test"),
      handler: "hello.handler",
    });
    const datadogCdk = new Datadog(stack, "Datadog", {
      nodeLayerVersion: 20,
      pythonLayerVersion: 28,
      addLayers: true,
      forwarderArn: "arn:test:forwarder:sa-east-1:12345678:1",
      enableDatadogTracing: true,
      enableDatadogLogs: true,
      flushMetricsToLogs: true,
      site: "datadoghq.com",
    });
    datadogCdk.addLambdaFunctions([nodeLambda]);
    let throwsError;
    try {
      datadogCdk.addLambdaFunctions([nodeLambda]);
    } catch (e) {
      throwsError = true;
    }
    expect(throwsError).toBe(true);
  });

  it("Adds a log group subscription to a lambda in a nested CDK stack", () => {
    const app = new App();
    const RootStack = new Stack(app, "RootStack");
    const NestStack = new NestedStack(RootStack, "NestedStack");

    const NestedStackLambda = new lambda.Function(NestStack, "NestedStackLambda", {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset("test"),
      handler: "hello.handler",
    });
    const NestedStackDatadogCdk = new Datadog(NestStack, "NestedStackDatadogCdk", {
      nodeLayerVersion: 20,
      pythonLayerVersion: 28,
      addLayers: true,
      forwarderArn: "arn:test:forwarder:sa-east-1:12345678:1",
      enableDatadogTracing: true,
      enableDatadogLogs: true,
      flushMetricsToLogs: true,
      site: "datadoghq.com",
    });
    NestedStackDatadogCdk.addLambdaFunctions([NestedStackLambda]);

    Template.fromStack(NestStack).hasResourceProperties("AWS::Logs::SubscriptionFilter", {
      DestinationArn: "arn:test:forwarder:sa-east-1:12345678:1",
      FilterPattern: "",
    });
  });

  it("Adds DD Lambda Extension when using a nested CDK stack", () => {
    const app = new App();
    const RootStack = new Stack(app, "RootStack", {
      env: {
        region: "sa-east-1",
      },
    });
    const NestStack = new NestedStack(RootStack, "NestedStack");

    const NestedStackLambda = new lambda.Function(NestStack, "NestedStackLambda", {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset("test"),
      handler: "hello.handler",
    });
    const NestedStackDatadogCdk = new Datadog(NestStack, "NestedStackDatadogCdk", {
      nodeLayerVersion: 20,
      pythonLayerVersion: 28,
      addLayers: true,
      extensionLayerVersion: 6,
      apiKey: "1234",
      enableDatadogTracing: true,
      enableDatadogLogs: true,
      flushMetricsToLogs: true,
      site: "datadoghq.com",
    });
    NestedStackDatadogCdk.addLambdaFunctions([NestedStackLambda]);

    Template.fromStack(NestStack).hasResourceProperties("AWS::Lambda::Function", {
      Layers: [
        `arn:aws:lambda:sa-east-1:${DD_ACCOUNT_ID}:layer:Datadog-Node12-x:20`,
        `arn:aws:lambda:sa-east-1:${DD_ACCOUNT_ID}:layer:Datadog-Extension:6`,
      ],
    });
  });
});

describe("applyLayers", () => {
  it("if addLayers is not given, layer is added", () => {
    const app = new App();
    const stack = new Stack(app, "stack", {
      env: {
        region: "us-west-2",
      },
    });
    const hello = new lambda.Function(stack, "HelloHandler", {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromInline("test"),
      handler: "hello.handler",
    });
    const datadogCDK = new Datadog(stack, "Datadog", {
      nodeLayerVersion: 39,
      pythonLayerVersion: 24,
      forwarderArn: "arn:test:forwarder:sa-east-1:12345678:1",
    });
    datadogCDK.addLambdaFunctions([hello]);
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Handler: `${JS_HANDLER_WITH_LAYERS}`,
    });
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: {
          [DD_HANDLER_ENV_VAR]: "hello.handler",
          [FLUSH_METRICS_TO_LOGS_ENV_VAR]: "true",
          [ENABLE_DD_TRACING_ENV_VAR]: "true",
          [ENABLE_DD_LOGS_ENV_VAR]: "true",
          [CAPTURE_LAMBDA_PAYLOAD_ENV_VAR]: "false",
          [INJECT_LOG_CONTEXT_ENV_VAR]: "true",
        },
      },
    });
  });

  it("does not add layers when addLayers is false", () => {
    const app = new App();
    const stack = new Stack(app, "stack", {
      env: {
        region: "us-west-2",
      },
    });
    const hello = new lambda.Function(stack, "HelloHandler", {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromInline("test"),
      handler: "hello.handler",
    });
    const datadogCDK = new Datadog(stack, "Datadog", {
      nodeLayerVersion: 80,
      extensionLayerVersion: 23,
      apiKey: "1234",
      addLayers: false,
    });
    datadogCDK.addLambdaFunctions([hello]);
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Handler: `${JS_HANDLER}`,
      Layers: Match.absent(),
    });
  });

  it("layer is added for python", () => {
    const app = new App();
    const stack = new Stack(app, "stack", {
      env: {
        region: "us-west-2",
      },
    });
    const hello = new lambda.Function(stack, "HelloHandler", {
      runtime: lambda.Runtime.PYTHON_3_6,
      code: lambda.Code.fromInline("test"),
      handler: "hello.handler",
    });
    const datadogCDK = new Datadog(stack, "Datadog", {
      nodeLayerVersion: 39,
      pythonLayerVersion: 24,
      forwarderArn: "arn:test:forwarder:sa-east-1:12345678:1",
    });
    datadogCDK.addLambdaFunctions([hello]);
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Handler: `${PYTHON_HANDLER}`,
    });
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: {
          [DD_HANDLER_ENV_VAR]: "hello.handler",
          [FLUSH_METRICS_TO_LOGS_ENV_VAR]: "true",
          [ENABLE_DD_TRACING_ENV_VAR]: "true",
          [ENABLE_DD_LOGS_ENV_VAR]: "true",
          [CAPTURE_LAMBDA_PAYLOAD_ENV_VAR]: "false",
          [INJECT_LOG_CONTEXT_ENV_VAR]: "true",
        },
      },
    });
  });

  it("subscription filter is added", () => {
    const app = new App();
    const stack = new Stack(app, "stack", {
      env: {
        region: "us-west-2",
      },
    });
    const hello = new lambda.Function(stack, "HelloHandler", {
      runtime: lambda.Runtime.PYTHON_3_6,
      code: lambda.Code.fromInline("test"),
      handler: "hello.handler",
    });
    const hello1 = new lambda.Function(stack, "HelloHandler1", {
      runtime: lambda.Runtime.PYTHON_3_6,
      code: lambda.Code.fromInline("test"),
      handler: "hello.handler",
    });
    const hello2 = new lambda.Function(stack, "HelloHandler2", {
      runtime: lambda.Runtime.PYTHON_3_6,
      code: lambda.Code.fromInline("test"),
      handler: "hello.handler",
    });

    const datadogCDK = new Datadog(stack, "Datadog", {
      nodeLayerVersion: 39,
      pythonLayerVersion: 24,
      forwarderArn: "arn:test:forwarder:sa-east-1:12345678:1",
    });
    datadogCDK.addLambdaFunctions([hello, hello1, hello2]);
    Template.fromStack(stack).resourceCountIs("AWS::Logs::SubscriptionFilter", 3);
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Handler: `${PYTHON_HANDLER}`,
    });
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: {
          [DD_HANDLER_ENV_VAR]: "hello.handler",
          [FLUSH_METRICS_TO_LOGS_ENV_VAR]: "true",
          [ENABLE_DD_TRACING_ENV_VAR]: "true",
          [ENABLE_DD_LOGS_ENV_VAR]: "true",
          [CAPTURE_LAMBDA_PAYLOAD_ENV_VAR]: "false",
          [INJECT_LOG_CONTEXT_ENV_VAR]: "true",
        },
      },
    });
  });
});
