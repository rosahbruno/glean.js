/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { OptionalAsync } from "../types.js";

export const DISPATCHER_LOG_TAG = "core.Dispatcher";

// The possible states a dispatcher instance can be in.
export const enum DispatcherState {
  // The dispatcher has not been initialized yet.
  //
  // When the dispatcher is in this state it will not enqueue
  // more than `maxPreInitQueueSize` tasks.
  Uninitialized = "Uninitialized",
  // There are no commands queued and the dispatcher is idle.
  Idle = "Idle",
  // The dispatcher is currently processing queued tasks.
  Processing = "Processing",
  // The dispatcher is stopped, tasks queued will not be immediately processed.
  Stopped = "Stopped",
  // The dispatcher is shutdown, attempting to queue tasks while in this state is a no-op.
  //
  // This state is irreversible.
  Shutdown = "Shutdown"
}

// The possible commands to be processed by the dispatcher.
export const enum Commands {
  // The dispatcher will enqueue a new task.
  //
  // This command is always followed by a concrete task for the dispatcher to execute.
  Task = "Task",
  // Same as the `Task` command,
  // but the task enqueued by this command is not cleared by the `Clear` command.
  //
  // # Note
  //
  // `Shutdown` will still clear these tasks.
  //
  // Unless unavoidable, prefer using the normal `Task`.
  PersistentTask = "PersistentTask",
  // Same as the `Task` command, but only tasks passed to `flushInit` to be performed
  // as the first task ever are considered `InitTask`. This task is special because if
  // it fails, the dispatcher will not proceed executing any other tasks and will shutdown.
  //
  // This command is always followed by a concrete task for the dispatcher to execute.
  InitTask = "InitTask",
  // The dispatcher should stop executing the queued tasks.
  Stop = "Stop",
  // The dispatcher should stop executing the queued tasks and clear the queue.
  Clear = "Clear",
  // The dispatcher will clear the queue and go into the Shutdown state.
  Shutdown = "Shutdown",
  // Exactly like a normal Task, but spawned for tests.
  TestTask = "TestTask"
}

export type TaskCommands =
  | Commands.Task
  | Commands.TestTask
  | Commands.PersistentTask
  | Commands.InitTask;

/**
 * A task dispatcher for async tasks.
 *
 * Will make sure tasks are execute in order.
 */
export interface IDispatcher {
  /**
   * Adds a task to the end of this dispatchers queue.
   *
   * Kick-starts the execution of the queue in case the dispatcher currently Idle.
   *
   * # Note
   *
   * Will not enqueue in case the dispatcher has not been initialized yet
   * and the queues length exceeds `maxPreInitQueueSize`.
   *
   * @param task The task to enqueue.
   */
  launch(task: () => OptionalAsync<void>): void;

  /**
   * Works exactly like {@link launch},
   * but enqueues a persistent task which is not cleared by the Clear command.
   *
   * @param task The task to enqueue.
   */
  launchPersistent(task: () => OptionalAsync<void>): void;

  /**
   * Flushes the tasks enqueued while the dispatcher was uninitialized.
   *
   * This is a no-op in case the dispatcher is not in an uninitialized state.
   *
   * @param task Optional task to execute before any of the tasks enqueued prior to init.
   *        Note: if this task throws, the dispatcher will be shutdown and no other tasks will be executed.
   */
  flushInit(task?: () => OptionalAsync<void>): void;

  /**
   * Enqueues a Clear command at the front of the queue and triggers execution.
   *
   * The Clear command will remove all other tasks
   * except for persistent tasks or shutdown tasks.
   *
   * # Note
   *
   * Even if the dispatcher is stopped this command will be executed.
   *
   * @param priorityTask Whether or not to launch the clear command as a priority task.
   */
  clear(priorityTask?: boolean): void;

  /**
   * Enqueues a Stop command at the front of the queue and triggers execution.
   *
   * The Stop command will stop execution of current tasks
   * and put the Dispatcher in a Stopped state.
   *
   * While stopped the dispatcher will still enqueue tasks but won't execute them.
   *
   * In order to re-start the dispatcher, call the `resume` method.
   *
   * # Note
   *
   * In case a Shutdown command has been launched before this command,
   * this command will result in the queue being cleared.
   *
   * @param priorityTask Whether or not to launch the clear command as a priority task.
   * This is `true` by default.
   */
  stop(priorityTask?: boolean): void;

  /**
   * Resumes execution os tasks if the dispatcher is stopped.
   *
   * This is a no-op if the dispatcher is not stopped.
   */
  resume(): void;

  /**
   * Shuts down the dispatcher.
   *
   * 1. Executes all tasks launched prior to this one.
   * 2. Clears the queue of any tasks launched after this one (even persistent tasks).
   * 3. Puts the dispatcher in the `Shutdown` state.
   *
   * # Note
   *
   * - This is a command like any other, if the dispatcher is uninitialized
   *   it will get executed when the dispatcher is initialized.
   * - If the dispatcher is stopped, it is resumed and all pending tasks are executed.
   *
   * @returns A promise which resolves once shutdown is complete.
   */
  shutdown(): OptionalAsync<void>;

  /**
   * Test-only API
   *
   * Returns a promise that resolves once the current task execution in finished.
   *
   * Use this with caution.
   * If called inside a task launched inside another task, it will cause a deadlock.
   *
   * @returns The promise.
   */
  testBlockOnQueue(): OptionalAsync<void>;

  /**
   * Test-only API
   *
   * Returns the dispatcher back to an uninitialized state.
   *
   * This will also stop ongoing tasks and clear the queue.
   *
   * If the dispatcher is already in an uninitialized state, this is no-op.
   */
  testUninitialize(): OptionalAsync<void>;

  /**
   * Launches a task in test mode.
   *
   * # Note
   *
   * This function will resume the execution of tasks if the dispatcher was stopped
   * and return the dispatcher back to an idle state.
   *
   * This is important in order not to hang forever in case the dispatcher is stopped.
   *
   * # Errors
   *
   * This function will reject in case the task is not launched.
   * Make sure the dispatcher is initialized or is not shutdown in these cases.
   *
   * @param task The task to launch.
   * @returns A promise which only resolves once the task is done being executed
   *          or is guaranteed to not be executed ever i.e. if the queue gets cleared.
   */
  testLaunch(task: () => OptionalAsync<void>): OptionalAsync<void>;
}
