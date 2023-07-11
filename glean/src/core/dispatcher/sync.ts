/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { TaskCommands } from "./shared.js";

import log, { LoggingLevel } from "../log.js";
import { Commands, DispatcherState, DISPATCHER_LOG_TAG } from "./shared.js";
import { Context } from "../context.js";

type Task = () => void;
type Command =
  | {
      task: Task;
      command: Exclude<TaskCommands, Commands.TestTask>;
    }
  | {
      resolver: (value: void | PromiseLike<void>) => void;
      task: Task;
      command: Commands.TestTask;
    }
  | {
      command: Exclude<Commands, TaskCommands>;
    };

// See `IDispatcher` for method documentation.
class DispatcherSync {
  // A FIFO queue of tasks to execute.
  private queue: Command[];
  // A FIFO queue of tasks dispatched before Glean was initialized.
  //
  // More specifically, this queue holds all tasks dispatched before the
  // web migration code runs.
  private preInitQueue: Command[];
  // The current state of this dispatcher.
  private state: DispatcherState;
  // Whether or not the dispatcher is currently in the process of shutting down
  // i.e. a Shutdown command is in the queue.
  private shuttingDown = false;

  constructor(readonly maxPreInitQueueSize = 100, readonly logTag = DISPATCHER_LOG_TAG) {
    this.queue = [];
    this.preInitQueue = [];
    this.state = DispatcherState.Uninitialized;
  }

  /// PRIVATE ///
  /**
   * Gets the oldest command added to the queue.
   *
   * @returns The oldest command or `undefined` if the queue is empty.
   */
  private getNextCommand(): Command | undefined {
    return this.queue.shift();
  }

  /**
   * Gets the oldest command added to the pre-init queue.
   *
   * @returns The oldest command or `undefined` if the queue is empty.
   */
  private getNextPreInitCommand(): Command | undefined {
    return this.preInitQueue.shift();
  }

  /**
   * Executes a task safely, catching any errors.
   *
   * @param task The  task to execute.
   * @returns Whether or not the task was executed successfully.
   */
  private executeTask(task: Task): boolean {
    try {
      task();
      return true;
    } catch (e) {
      log(
        this.logTag,
        `Error executing Glean task${
          e ? `: ${e as string}` : ". There might be more error logs above."
        }`,
        LoggingLevel.Error
      );
      return false;
    }
  }

  /**
   * Resolve all test resolvers.
   *
   * Used before clearing the queue in on a `Shutdown` or `Clear` command.
   */
  private unblockTestResolvers(): void {
    this.queue.forEach((c) => {
      if (c.command === Commands.TestTask) {
        c.resolver();
      }
    });
  }

  /**
   * Executes all the commands in the queues, from oldest to newest.
   */
  private execute(): void {
    let nextCommand;
    if (this.preInitQueue.length > 0) {
      // Anytime there is something in the preInit queue, it needs to execute first.
      nextCommand = this.getNextPreInitCommand();
    } else {
      nextCommand = this.getNextCommand();
    }

    while (nextCommand) {
      switch (nextCommand.command) {
      case Commands.Stop:
        this.state = DispatcherState.Stopped;
        return;
      case Commands.Shutdown:
        this.unblockTestResolvers();
        this.queue = [];
        this.state = DispatcherState.Shutdown;
        this.shuttingDown = false;
        return;
      case Commands.Clear:
        this.unblockTestResolvers();
        this.queue = this.queue.filter((c) =>
          [Commands.PersistentTask, Commands.Shutdown].includes(c.command)
        );
        break;
      case Commands.TestTask:
        this.executeTask(nextCommand.task);
        nextCommand.resolver();
        break;
      case Commands.InitTask:
        const result = this.executeTask(nextCommand.task);
        if (!result) {
          log(
            this.logTag,
            [
              "Error initializing dispatcher, won't execute anything further.",
              "There might be more error logs above."
            ],
            LoggingLevel.Error
          );
          this.clear();
          void this.shutdown();
        }
        break;
      case Commands.PersistentTask:
      case Commands.Task:
        this.executeTask(nextCommand.task);
        break;
      }

      if (this.preInitQueue.length > 0) {
        nextCommand = this.getNextPreInitCommand();
      } else {
        nextCommand = this.getNextCommand();
      }
    }
  }

  /**
   * Triggers the execution of enqueued command
   * in case the dispatcher is currently Idle.
   */
  private triggerExecution(): void {
    if (this.state === DispatcherState.Idle && this.queue.length > 0) {
      this.state = DispatcherState.Processing;
      this.execute();
    }
  }

  /**
   * Internal method to launch a task and trigger execution.
   *
   * Allows enqueueing of any valid command.
   *
   * Allows prioritization of tasks, to add tasks at the front of the queue.
   * When a task is marked as a `priorityTask` it will be enqueued
   * regardless of the `maxPreInitQueueSize being overflown.
   *
   * @param command The command to enqueue.
   * @param priorityTask Whether or not this task is a priority task
   *        and should be enqueued at the front of the queue.
   * @returns Whether or not the task was queued.
   */
  private launchInternal(command: Command, priorityTask = false): boolean {
    if (!Context.initialized) {
      console.log("pushing to preInitQueue");
      this.preInitQueue.push(command);
      return true;
    }

    if (this.state === DispatcherState.Shutdown) {
      log(
        this.logTag,
        "Attempted to enqueue a new task but the dispatcher is shutdown. Ignoring.",
        LoggingLevel.Warn
      );
      return false;
    }

    if (!priorityTask && this.state === DispatcherState.Uninitialized) {
      if (this.queue.length >= this.maxPreInitQueueSize) {
        log(this.logTag, "Unable to enqueue task, pre init queue is full.", LoggingLevel.Warn);
        return false;
      }
    }

    if (priorityTask) {
      this.queue.unshift(command);
    } else {
      this.queue.push(command);
    }

    this.triggerExecution();

    return true;
  }

  /// PUBLIC ///
  launch(task: Task): void {
    this.launchInternal({
      task,
      command: Commands.Task
    });
  }

  launchPersistent(task: Task): void {
    this.launchInternal({
      task,
      command: Commands.PersistentTask
    });
  }

  flushInit(task?: Task): void {
    if (this.state !== DispatcherState.Uninitialized) {
      log(
        this.logTag,
        "Attempted to initialize the Dispatcher, but it is already initialized. Ignoring.",
        LoggingLevel.Warn
      );
      return;
    }

    if (task) {
      this.launchInternal(
        {
          task,
          command: Commands.InitTask
        },
        true
      );
    }

    this.state = DispatcherState.Idle;
    this.triggerExecution();
  }

  clear(priorityTask = true): void {
    this.launchInternal({ command: Commands.Clear }, priorityTask);
    this.resume();
  }

  stop(priorityTask = true): void {
    if (this.shuttingDown) {
      this.clear(priorityTask);
    } else {
      this.launchInternal({ command: Commands.Stop }, priorityTask);
    }
  }

  resume(): void {
    if (this.state === DispatcherState.Stopped) {
      this.state = DispatcherState.Idle;
      this.triggerExecution();
    }
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.launchInternal({ command: Commands.Shutdown });
    this.resume();
  }

  testBlockOnQueue(): void {
    // Stub function for sync implementation.
    return;
  }

  testUninitialize(): void {
    if (this.state === DispatcherState.Uninitialized) {
      return;
    }

    // Clear queue.
    this.clear();
    // Wait for the clear command and any persistent tasks that may still be in the queue.
    this.shutdown();
    this.state = DispatcherState.Uninitialized;
  }

  testLaunch(task: Task): Promise<void> {
    return new Promise((resolver, reject) => {
      this.resume();
      const wasLaunched = this.launchInternal({
        resolver,
        task,
        command: Commands.TestTask
      });

      if (!wasLaunched) {
        reject();
      }
    });
  }
}

export default DispatcherSync;
